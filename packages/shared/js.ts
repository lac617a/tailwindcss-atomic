import {parse} from "@babel/parser";
import generateImport from "@babel/generator";
import traverseImport from "@babel/traverse";

import {ATOMIC_RUNTIME} from "./constants";
import {transformClassString} from "./css";
import {getCalleeName} from "./utils";
import {processArgument} from "../core/process";

function interopDefault<T>(mod: T | {default: T}): T {
	let current: unknown = mod;
	while (current && typeof current === "object" && "default" in current) {
		current = (current as {default: unknown}).default;
	}
	return current as T;
}

const generate = interopDefault(generateImport);
const traverse = interopDefault(traverseImport);

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
		return {code: null, map: null};
	}

	try {
		const ast = parse(code, {
			sourceType: "module",
			plugins: ["jsx", "typescript"],
		});

		let hasModifications = false;
		const classMap = ATOMIC_RUNTIME.classMap;

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

				if (funcName && targetFunctions.has(funcName)) {
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

							let key: string | undefined;
							if (!prop.computed && prop.key.type === "Identifier") {
								key = prop.key.name;
							} else if (prop.key.type === "StringLiteral") {
								key = prop.key.value;
							}

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

		if (!hasModifications) return {code: null, map: null};

		const output = generate(ast, {}, code);

		return {
			code: output.code,
			map: output.map,
		};
	} catch {
		return {code: null, map: null};
	}
}

export {transformJs, isJsFile, invalidateJsModules};
