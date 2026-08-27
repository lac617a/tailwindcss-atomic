import postcss from "postcss";
import {parse} from "@babel/parser";
import generate from "@babel/generator";
import type {Root as PostcssRoot} from "postcss";

import {NESTED_AT_RULES, ATOMIC_RUNTIME} from "./constants";

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

function isJsFile(id: string) {
	const cleanId = id.split("?")[0]?.replace(/\\/g, "/");

	if (!cleanId) return false;

	return /\.(jsx?|tsx?|mjs|cjs)$/.test(cleanId);
}

function invalidateJsModules() {
	const server = ATOMIC_RUNTIME.viteServer;
	if (!server?.moduleGraph) return;

	for (const [id, mod] of server.moduleGraph.idToModuleMap) {
		if (!mod) continue;
		if (!isJsFile(id)) continue;
		server.moduleGraph.invalidateModule(mod);
	}
}

function transformJs(code: string, targetFunctions: Set<string>) {
	if (!code || Object.keys(ATOMIC_RUNTIME.classMap).length === 0) {
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

export {transformJs, isJsFile, invalidateJsModules, atomicizeContainer};
