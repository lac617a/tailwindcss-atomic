import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {createUnplugin} from "unplugin";
import {parse} from "@babel/parser";
import babelTraverse from "@babel/traverse";
import generate from "@babel/generator";
import postcss from "postcss";

const traverse = babelTraverse.default || babelTraverse;

const ATOMIC_MARKER = "/*! tailwind-atomic */";
const TAILWIND_DIRECTIVE_RE =
	/@tailwind\b|@(?:import|use|reference)\s+["']tailwindcss(?:\/[^"']*)?["']/;
const NESTED_AT_RULES = new Set(["media", "supports", "container"]);

const req = createRequire(import.meta.url);
const wasmPath = req.resolve("../pkg/tailwind_atomic_wasm.js");
const {process_tailwind_css} = req(wasmPath);

const atomicRuntime = {
	classMap: Object.create(null),
	viteServer: null,
	targetFunctions: new Set(["clsx", "classnames", "cn", "cva"]),
};

function unescapeCssClassName(value) {
	return value.replace(/\\([^\n\r\f0-9a-fA-F])/g, "$1");
}

function toPlainMap(classMap) {
	if (!classMap) return {};
	if (classMap instanceof Map) {
		return Object.fromEntries(classMap);
	}
	return classMap;
}

function mergeClassMap(classMap) {
	let changed = false;
	const plain = toPlainMap(classMap);

	for (const [rawKey, value] of Object.entries(plain)) {
		if (typeof value !== "string" || !value) continue;
		const key = unescapeCssClassName(rawKey);
		if (atomicRuntime.classMap[key] !== value) {
			atomicRuntime.classMap[key] = value;
			changed = true;
		}
	}

	return changed;
}

function hasTailwindDirectives(css) {
	return TAILWIND_DIRECTIVE_RE.test(css);
}

function isAlreadyAtomic(css) {
	return css.includes(ATOMIC_MARKER);
}

function flattenLayerAtRules(root) {
	let remaining = true;
	while (remaining) {
		remaining = false;
		root.walkAtRules("layer", (atRule) => {
			atRule.replaceWith(atRule.nodes ? atRule.nodes : []);
			remaining = true;
		});
	}
}

function isUtilityRule(node) {
	return node.type === "rule" && String(node.selector).includes(".");
}

function atomicizeContainer(container) {
	if (!container.nodes) return false;

	let mapChanged = false;

	for (const node of [...container.nodes]) {
		if (node.type === "atrule" && NESTED_AT_RULES.has(node.name)) {
			if (atomicizeContainer(node)) mapChanged = true;
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

/**
 * Corre el WASM solo sobre utilidades (`.flex`, `.bg-red-500`, …).
 * Conserva `@theme`, `:root`, preflight, `@keyframes` y `@media`
 * para que funcionen colores de Tailwind v3, v4 y SCSS.
 */
function applyAtomicCss(css) {
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
	const server = atomicRuntime.viteServer;
	if (!server?.moduleGraph) return;

	for (const [id, mod] of server.moduleGraph.idToModuleMap) {
		if (!mod) continue;
		const cleanId = String(id).split("?")[0];
		if (!/\.(jsx?|tsx?|mjs|cjs)$/.test(cleanId)) continue;
		server.moduleGraph.invalidateModule(mod);
	}
}

function transformClassString(classStr, classMap) {
	if (!classStr) return classStr;
	return classStr
		.split(/\s+/)
		.filter(Boolean)
		.map((cls) => classMap[cls] || classMap[unescapeCssClassName(cls)] || cls)
		.join(" ");
}

function processArgument(argNode, classMap) {
	if (!argNode) return false;
	let modified = false;

	if (argNode.type === "StringLiteral") {
		argNode.value = transformClassString(argNode.value, classMap);
		return true;
	}

	if (argNode.type === "TemplateLiteral") {
		argNode.quasis.forEach((element) => {
			if (element.value && element.value.raw) {
				element.value.raw = transformClassString(element.value.raw, classMap);
				element.value.cooked = transformClassString(
					element.value.cooked,
					classMap,
				);
				modified = true;
			}
		});
		return modified;
	}

	if (argNode.type === "ObjectExpression") {
		argNode.properties.forEach((prop) => {
			if (prop.type === "ObjectProperty") {
				if (prop.key.type === "StringLiteral") {
					prop.key.value = transformClassString(prop.key.value, classMap);
					modified = true;
				} else if (prop.key.type === "Identifier" && !prop.computed) {
					prop.key.name = transformClassString(prop.key.name, classMap);
					modified = true;
				}
			}
		});
		return modified;
	}

	if (argNode.type === "ArrayExpression") {
		argNode.elements.forEach((el) => {
			if (processArgument(el, classMap)) modified = true;
		});
		return modified;
	}

	if (argNode.type === "ConditionalExpression") {
		const altMod = processArgument(argNode.alternate, classMap);
		const consMod = processArgument(argNode.consequent, classMap);
		return altMod || consMod;
	}

	if (argNode.type === "LogicalExpression") {
		return processArgument(argNode.right, classMap);
	}

	return false;
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
							prop.key.type === "Identifier"
								? prop.key.name
								: prop.key.value;
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

export async function transformAtomicSource(code, id) {
	await warmupClassMapFromCss();
	if (!code || !id) return null;

	const cleanId = String(id).split("?")[0].replace(/\\/g, "/");
	if (cleanId.includes("node_modules") || cleanId.includes("/.next/")) {
		return null;
	}
	if (!isJsFile(cleanId)) return null;

	return transformJs(code, atomicRuntime.targetFunctions);
}

function rewriteBundle(bundle, targetFunctions) {
	for (const file of Object.values(bundle)) {
		if (file.type === "asset" && file.fileName.endsWith(".css")) {
			const source =
				typeof file.source === "string" ? file.source : file.source.toString();
			const {code, changed} = applyAtomicCss(source);
			if (changed) {
				file.source = code;
			}
		}
	}

	for (const file of Object.values(bundle)) {
		if (file.type === "chunk" && typeof file.code === "string") {
			const result = transformJs(file.code, targetFunctions);
			if (result) {
				file.code = result.code;
			}
		}
	}
}

/**
 * PostCSS plugin: va DESPUÉS de Tailwind.
 * Tailwind expande @tailwind/@import; este plugin lee esas reglas
 * y las parte en clases atómicas `_twa(hex)`.
 */
export function postcssTailwindAtomic() {
	return {
		postcssPlugin: "postcss-tailwind-atomic",
		Once(root, {postcss: processor}) {
			const css = root.toString();
			const {code, changed, mapChanged} = applyAtomicCss(css);
			if (!changed) return;

			if (mapChanged) {
				invalidateJsModules();
			}

			const parsed = processor.parse(code, {
				from: root.source?.input?.from,
			});
			root.removeAll();
			root.append(parsed.nodes);
		},
	};
}
postcssTailwindAtomic.postcss = true;

const CSS_ENTRY_CANDIDATES = [
	"app/globals.css",
	"src/app/globals.css",
	"src/index.css",
	"src/globals.css",
	"app/index.css",
	"styles/index.css",
	"styles/globals.css",
	"css/index.css",
	"css/styles.css",
	"css/globals.css",
	"scss/index.scss",
	"scss/styles.scss",
	"scss/globals.scss",
];

let warmupPromise;

async function warmupClassMapFromCss() {
	if (Object.keys(atomicRuntime.classMap).length > 0) return;
	if (warmupPromise) return warmupPromise;

	warmupPromise = (async () => {
		const {existsSync, readFileSync} = await import("node:fs");
		const {resolve, join} = await import("node:path");

		const cssPath = CSS_ENTRY_CANDIDATES.map((rel) =>
			resolve(process.cwd(), rel),
		).find((abs) => existsSync(abs));
		if (!cssPath) return;

		const appRequire = createRequire(join(process.cwd(), "package.json"));
		const plugins = [];
		try {
			const tw = appRequire("@tailwindcss/postcss");
			plugins.push(tw.default || tw);
		} catch {
			try {
				plugins.push(appRequire("tailwindcss"));
			} catch {
				return;
			}
		}

		plugins.push(postcssTailwindAtomic());
		const source = readFileSync(cssPath, "utf8");
		await postcss(plugins).process(source, {from: cssPath});
	})();

	return warmupPromise;
}

export const TailwindAtomicPlugin = createUnplugin((options = {}) => {
	const targetFunctions = new Set(
		options.targetFunctions || ["clsx", "classnames", "cn", "cva"],
	);
	atomicRuntime.targetFunctions = targetFunctions;

	// Opcional: pre-cargar el mapa si alguien todavía pasa CSS compilado.
	if (options.tailwindCss) {
		const {class_map} = process_tailwind_css(options.tailwindCss);
		mergeClassMap(class_map);
	}

	function processCssAndMaybeInvalidate(css) {
		const result = applyAtomicCss(css);
		if (result.mapChanged) {
			invalidateJsModules();
		}
		return result;
	}

	return {
		name: "tailwind-atomic-plugin",
		enforce: "post",

		async buildStart() {
			await warmupClassMapFromCss();
		},

		transformInclude(id) {
			if (!id) return false;

			const cleanId = id.split("?")[0].replace(/\\/g, "/");
			const normalizedCwd = process.cwd().replace(/\\/g, "/");

			if (cleanId.includes("node_modules") || cleanId.includes(".next")) {
				return false;
			}

			const isInside =
				cleanId.startsWith(normalizedCwd) ||
				id.replace(/\\/g, "/").startsWith(normalizedCwd);

			return isInside && (isCssFile(cleanId) || isJsFile(cleanId));
		},

		async transform(code, id) {
			await warmupClassMapFromCss();

			if (isCssFile(id)) {
				const {code: next, changed} = processCssAndMaybeInvalidate(code);
				if (!changed) return null;
				return {code: next, map: null};
			}

			if (isJsFile(id)) {
				return transformJs(code, targetFunctions);
			}

			return null;
		},

		vite: {
			configureServer(server) {
				atomicRuntime.viteServer = server;
			},
		},

		rollup: {
			generateBundle(_options, bundle) {
				rewriteBundle(bundle, targetFunctions);
			},
		},

		webpack(compiler) {
			const {Compilation, sources, NormalModule} = compiler.webpack;
			const {RawSource} = sources;
			const webpackLoaderPath = resolveWebpackLoaderPath();

			compiler.hooks.compilation.tap(
				"tailwind-atomic-plugin",
				(compilation) => {
					NormalModule.getCompilationHooks(compilation).loader.tap(
						"tailwind-atomic-plugin",
						(_loaderContext, module) => {
							const resource = module.resource;
							if (!resource || !isJsFile(resource)) return;
							if (
								resource.includes("node_modules") ||
								resource.includes(`${path.sep}.next${path.sep}`)
							) {
								return;
							}

							const already = module.loaders.some(
								(loader) =>
									typeof loader.loader === "string" &&
									loader.loader.includes("webpack-loader.cjs"),
							);
							if (already) return;

							module.loaders.push({
								loader: webpackLoaderPath,
								ident: null,
								type: null,
							});
						},
					);

					compilation.hooks.processAssets.tapPromise(
						{
							name: "tailwind-atomic-plugin",
							stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE,
						},
						async (assets) => {
							await warmupClassMapFromCss();
							for (const [fileName, asset] of Object.entries(assets)) {
								const source = asset.source();
								const text =
									typeof source === "string" ? source : source.toString();

								if (fileName.endsWith(".css")) {
									const {code, changed} = applyAtomicCss(text);
									if (changed) {
										compilation.updateAsset(fileName, new RawSource(code));
									}
									continue;
								}

								if (/\.[cm]?js$/.test(fileName)) {
									const result = transformJs(text, targetFunctions);
									if (result) {
										compilation.updateAsset(
											fileName,
											new RawSource(result.code),
										);
									}
								}
							}
						},
					);
				},
			);
		},
	};
});

export const viteTailwindAtomic = TailwindAtomicPlugin.vite;
export const webpackTailwindAtomic = TailwindAtomicPlugin.webpack;
export const rollupTailwindAtomic = TailwindAtomicPlugin.rollup;
