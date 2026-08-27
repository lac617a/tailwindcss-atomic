import postcss from "postcss";
import type {Root as PostcssRoot, Rule as PostcssRule} from "postcss";

import {
	NESTED_AT_RULES,
	ATOMIC_MARKER,
	TAILWIND_DIRECTIVE_RE,
	ATOMIC_RUNTIME,
} from "./constants";

function hasTailwindDirectives(css: string) {
	return TAILWIND_DIRECTIVE_RE.test(css);
}

function isAlreadyAtomic(css: string) {
	return css.includes(ATOMIC_MARKER);
}

function flattenLayerAtRules(root: PostcssRoot) {
	let remaining = true;
	while (remaining) {
		remaining = false;
		root.walkAtRules("layer", (atRule) => {
			atRule.replaceWith(atRule.nodes ? atRule.nodes : []);
			remaining = true;
		});
	}
}

function unescapeCssClassName(value: string) {
	return value.replace(/\\([^\n\r\f0-9a-fA-F])/g, "$1");
}

function toPlainMap(classMap: Record<string, string>) {
	if (!classMap) return {};
	if (classMap instanceof Map) {
		return Object.fromEntries(classMap);
	}
	return classMap;
}

function mergeClassMap(classMap: Record<string, string>) {
	let changed = false;
	const plain = toPlainMap(classMap);

	for (const [rawKey, value] of Object.entries(plain)) {
		if (typeof value !== "string" || !value) continue;
		const key = unescapeCssClassName(rawKey);
		if (ATOMIC_RUNTIME.classMap[key] !== value) {
			ATOMIC_RUNTIME.classMap[key] = value;
			changed = true;
		}
	}

	return changed;
}

function isUtilityRule(node: PostcssRule) {
	return node.type === "rule" && String(node.selector).includes(".");
}

function atomicizeContainer(container: PostcssRoot) {
	if (!container.nodes) return false;

	let mapChanged = false;

	for (const node of [...container.nodes]) {
		if (node.type === "atrule" && NESTED_AT_RULES.has(node.name)) {
			if (atomicizeContainer(node as unknown as PostcssRoot)) mapChanged = true;
		}
	}

	const utilityNodes = container.nodes.filter(isUtilityRule);
	if (!utilityNodes.length) return mapChanged;

	const utilityCss = utilityNodes.map((node) => node.toString()).join("\n");
	const {class_map, css_rules} = process_tailwind_css(utilityCss);
	if (mergeClassMap(class_map)) mapChanged = true;

	const rules = Array.isArray(css_rules) ? css_rules : [];
	if (!rules.length) return mapChanged;

	const parsed = postcss.parse(rules.join("\n"));
	const first = utilityNodes[0];
	for (const atomicNode of parsed.nodes) {
		first.before(atomicNode.clone());
	}
	for (const node of utilityNodes) {
		node.remove();
	}

	return true;
}

function transformClassString(
	classStr: string,
	classMap: Record<string, string>,
) {
	if (!classStr) return classStr;
	return classStr
		.split(/\s+/)
		.filter(Boolean)
		.map((cls) => classMap[cls] || classMap[unescapeCssClassName(cls)] || cls)
		.join(" ");
}

/**
 * Corre el WASM solo sobre utilidades (`.flex`, `.bg-red-500`, …).
 * Conserva `@theme`, `:root`, preflight, `@keyframes` y `@media`
 * para que funcionen colores de Tailwind v3, v4 y SCSS.
 */
function applyAtomicCss(css: string) {
	if (!css || isAlreadyAtomic(css) || hasTailwindDirectives(css)) {
		return {code: css, changed: false};
	}

	try {
		const root = postcss.parse(css);
		flattenLayerAtRules(root);
		const changed = atomicizeContainer(root);
		if (!changed) {
			return {code: css, changed: false};
		}

		return {
			code: `${ATOMIC_MARKER}\n${root.toString()}`,
			changed: true,
			mapChanged: true,
		};
	} catch {
		return {code: css, changed: false};
	}
}

function invalidateJsModules() {
	const server = ATOMIC_RUNTIME.viteServer;
	if (!server?.moduleGraph) return;

	for (const [id, mod] of server.moduleGraph.idToModuleMap) {
		if (!mod) continue;
		const cleanId = String(id).split("?")[0];
		if (!/\.(jsx?|tsx?|mjs|cjs)$/.test(cleanId)) continue;
		server.moduleGraph.invalidateModule(mod);
	}
}

function getCalleeName(callee) {
	if (!callee) return null;
	if (callee.type === "Identifier") return callee.name;
	if (callee.type === "MemberExpression") {
		return callee.property.name || callee.property.value || null;
	}
	if (callee.type === "SequenceExpression") {
		return getCalleeName(callee.expressions[callee.expressions.length - 1]);
	}
	return null;
}

function transformJs(code, targetFunctions) {
	if (!code || Object.keys(atomicRuntime.classMap).length === 0) {
		return null;
	}

	try {
		const ast = parse(code, {
			sourceType: "module",
			plugins: ["jsx", "typescript"],
		});

		let hasModifications = false;
		const classMap = atomicRuntime.classMap;

		traverse(ast, {
			JSXAttribute(path) {
				if (path.node.name.name !== "className") return;

				if (path.node.value && path.node.value.type === "StringLiteral") {
					path.node.value.value = transformClassString(
						path.node.value.value,
						classMap,
					);
					hasModifications = true;
				}

				if (
					path.node.value &&
					path.node.value.type === "JSXExpressionContainer"
				) {
					if (processArgument(path.node.value.expression, classMap)) {
						hasModifications = true;
					}
				}
			},

			CallExpression(path) {
				const funcName = getCalleeName(path.node.callee);

				if (targetFunctions.has(funcName)) {
					path.node.arguments.forEach((arg) => {
						if (processArgument(arg, classMap)) {
							hasModifications = true;
						}
					});
				}

				if (
					funcName === "jsx" ||
					funcName === "jsxs" ||
					funcName === "_jsx" ||
					funcName === "_jsxs" ||
					funcName === "jsxDEV"
				) {
					const props = path.node.arguments[1];
					if (props && props.type === "ObjectExpression") {
						props.properties.forEach((prop) => {
							if (prop.type !== "ObjectProperty") return;
							const key =
								prop.key.type === "Identifier" ? prop.key.name : prop.key.value;
							if (key === "className" || key === "class") {
								if (processArgument(prop.value, classMap)) {
									hasModifications = true;
								}
							}
						});
					}
				}
			},
		});

		if (!hasModifications) return null;

		const generateFn = generate.default || generate;
		const output = generateFn(ast, {}, code);

		return {
			code: output.code,
			map: output.map,
		};
	} catch {
		return null;
	}
}

function isCssFile(id) {
	const cleanId = id.split("?")[0].replace(/\\/g, "/");
	if (/\.module\.(css|scss|sass|less|styl|pcss|postcss)$/.test(cleanId)) {
		return false;
	}
	return /\.(css|scss|sass|less|styl|pcss|postcss)$/.test(cleanId);
}

function isJsFile(id) {
	const cleanId = id.split("?")[0].replace(/\\/g, "/");
	return /\.(jsx?|tsx?|mjs|cjs)$/.test(cleanId);
}

function resolveWebpackLoaderPath() {
	const dir =
		typeof __dirname === "string"
			? __dirname
			: path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(dir, "..", "webpack-loader.cjs");
}

export {applyAtomicCss, invalidateJsModules};
