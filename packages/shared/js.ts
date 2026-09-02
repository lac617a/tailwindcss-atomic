import {parse} from "@babel/parser";
import generateImport from "@babel/generator";
import traverseImport from "@babel/traverse";
import {lstatSync, realpathSync} from "node:fs";
import path from "node:path";
import type {Node} from "@babel/types";
import type {NodePath} from "@babel/traverse";

import {ATOMIC_RUNTIME} from "./constants";
import {transformClassString} from "./css";
import {getCalleeName} from "./utils";
import {processArgument, processCvaCall} from "../core/process";

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

const linkedPackageCache = new Map<string, boolean>();

function posixId(id: string) {
	return String(id).split("?")[0]?.replace(/\\/g, "/") ?? "";
}

function withNodeModulesAnchor(cleanId: string) {
	if (cleanId.startsWith("/") || /^[a-zA-Z]:\//.test(cleanId)) return cleanId;
	return `/${cleanId}`;
}

function isBundlerOutputPath(cleanId: string) {
	return cleanId.includes("/.next/") || cleanId.includes("/.turbo/");
}

function nodeModulePackage(
	cleanId: string,
): {name: string; dir: string} | null {
	const anchored = withNodeModulesAnchor(cleanId);
	const marker = "/node_modules/";
	let from = 0;
	let found: {name: string; dir: string} | null = null;

	while (from < anchored.length) {
		const idx = anchored.indexOf(marker, from);
		if (idx === -1) break;
		const start = idx + marker.length;
		const rest = anchored.slice(start);
		from = start;
		if (
			rest.startsWith(".pnpm/") ||
			rest.startsWith(".bin/") ||
			rest.startsWith(".vite/")
		) {
			continue;
		}

		let name: string;
		if (rest.startsWith("@")) {
			const parts = rest.split("/");
			if (parts.length < 2 || !parts[0] || !parts[1]) continue;
			name = `${parts[0]}/${parts[1]}`;
		} else {
			name = rest.split("/")[0] ?? "";
		}
		if (!name || name.startsWith(".")) continue;

		const dirInAnchored = anchored.slice(0, start + name.length);
		const dir = cleanId.startsWith("/") || /^[a-zA-Z]:\//.test(cleanId)
			? dirInAnchored
			: dirInAnchored.replace(/^\//, "");
		found = {name, dir};
	}

	return found;
}

function isLinkedPackageDir(dir: string) {
	const key = path.resolve(dir).replace(/\\/g, "/").toLowerCase();
	const cached = linkedPackageCache.get(key);
	if (cached != null) return cached;

	let linked = false;
	try {
		if (lstatSync(dir).isSymbolicLink()) {
			linked = true;
		} else {
			const real = realpathSync(dir).replace(/\\/g, "/").toLowerCase();
			linked = real !== key;
		}
	} catch {
		linked = false;
	}

	linkedPackageCache.set(key, linked);
	return linked;
}

/**
 * Skip third-party node_modules and bundler output.
 * Keep app source, transpilePackages and workspace junctions (ui-latamwin).
 */
function shouldSkipJsTransform(id: string) {
	const cleanId = posixId(id);
	if (!cleanId) return true;
	if (isBundlerOutputPath(cleanId)) return true;

	const pkg = nodeModulePackage(cleanId);
	if (!pkg) return false;
	if (ATOMIC_RUNTIME.transpilePackages.has(pkg.name)) return false;
	if (isLinkedPackageDir(pkg.dir)) return false;
	return true;
}

function clearLinkedPackageCache() {
	linkedPackageCache.clear();
}

function invalidateJsModules() {
	const server = ATOMIC_RUNTIME.viteServer;
	if (server?.moduleGraph) {
		for (const [id, mod] of server.moduleGraph.idToModuleMap) {
			if (!mod) continue;
			if (!isJsFile(id)) continue;
			server.moduleGraph.invalidateModule(mod);
		}
	}

	for (const watching of ATOMIC_RUNTIME.webpackWatchings) {
		if (typeof watching.invalidate === "function") {
			try {
				watching.invalidate();
			} catch {
				// Watcher already closed.
			}
		}
	}
}

/**
 * Rollup/TS often extracts `cva(["flex", "items-center"], …)` into
 * `var classNameDefault = ["flex", "items-center"]; cva(classNameDefault, …)`.
 * Follow the binding and rewrite mapped class strings in arrays/objects.
 */
function rewriteMappedClassNode(
	node: Node | null | undefined,
	classMap: Record<string, string>,
): boolean {
	if (!node) return false;

	switch (node.type) {
		case "StringLiteral": {
			const next = transformClassString(node.value, classMap);
			if (next === node.value) return false;
			node.value = next;
			return true;
		}
		case "ArrayExpression": {
			let changed = false;
			for (const el of node.elements) {
				if (el && rewriteMappedClassNode(el, classMap)) changed = true;
			}
			return changed;
		}
		case "ObjectExpression": {
			let changed = false;
			for (const prop of node.properties) {
				if (prop.type !== "ObjectProperty") continue;
				let key: string | undefined;
				if (!prop.computed && prop.key.type === "Identifier") {
					key = prop.key.name;
				} else if (prop.key.type === "StringLiteral") {
					key = prop.key.value;
				}
				if (key === "defaultVariants") continue;
				if (rewriteMappedClassNode(prop.value, classMap)) changed = true;
			}
			return changed;
		}
		case "TemplateLiteral":
			return processArgument(node, classMap);
		case "ConditionalExpression": {
			const a = rewriteMappedClassNode(node.alternate, classMap);
			const b = rewriteMappedClassNode(node.consequent, classMap);
			return a || b;
		}
		case "LogicalExpression":
			return rewriteMappedClassNode(node.right, classMap);
		default:
			return false;
	}
}

function rewriteBoundClassName(
	argPath: NodePath,
	classMap: Record<string, string>,
): boolean {
	if (!argPath.isIdentifier()) return false;
	const binding = argPath.scope.getBinding(argPath.node.name);
	if (!binding?.path.isVariableDeclarator()) return false;
	const init = binding.path.node.init;
	return rewriteMappedClassNode(init, classMap);
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
				const attrName = path.node.name;
				const name =
					attrName.type === "JSXIdentifier" ? attrName.name : undefined;
				if (name !== "className" && name !== "class") return;

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

				if (funcName && ATOMIC_RUNTIME.preserveFunctions.has(funcName)) {
					return;
				}

				if (funcName === "cva" && targetFunctions.has("cva")) {
					if (processCvaCall(path.node.arguments, classMap)) {
						hasModifications = true;
					}
					for (const arg of path.get("arguments")) {
						if (rewriteBoundClassName(arg, classMap)) {
							hasModifications = true;
						}
						if (!arg.isObjectExpression()) continue;
						for (const prop of arg.get("properties")) {
							if (!prop.isObjectProperty()) continue;
							const value = prop.get("value");
							if (rewriteBoundClassName(value, classMap)) {
								hasModifications = true;
							}
							if (!value.isObjectExpression()) continue;
							for (const nested of value.get("properties")) {
								if (!nested.isObjectProperty()) continue;
								if (rewriteBoundClassName(nested.get("value"), classMap)) {
									hasModifications = true;
								}
							}
						}
					}
				} else if (funcName && targetFunctions.has(funcName)) {
					path.get("arguments").forEach((arg) => {
						if (processArgument(arg.node, classMap)) {
							hasModifications = true;
						}
						if (rewriteBoundClassName(arg, classMap)) {
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

			VariableDeclarator(path) {
				if (rewriteMappedClassNode(path.node.init, classMap)) {
					hasModifications = true;
				}
			},

			ArrayExpression(path) {
				const els = path.node.elements.filter(
					(el): el is NonNullable<typeof el> => Boolean(el),
				);
				if (!els.length || !els.every((el) => el.type === "StringLiteral")) {
					return;
				}
				if (rewriteMappedClassNode(path.node, classMap)) {
					hasModifications = true;
				}
			},

			ExportDefaultDeclaration(path) {
				if (rewriteMappedClassNode(path.node.declaration, classMap)) {
					hasModifications = true;
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

export {
	transformJs,
	isJsFile,
	invalidateJsModules,
	shouldSkipJsTransform,
	clearLinkedPackageCache,
};
