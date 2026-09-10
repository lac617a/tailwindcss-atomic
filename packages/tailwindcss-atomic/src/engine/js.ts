import {parse} from "@babel/parser";
import generateImport from "@babel/generator";
import traverseImport from "@babel/traverse";
import * as t from "@babel/types";
import {lstatSync, realpathSync} from "node:fs";
import path from "node:path";
import type {Node} from "@babel/types";
import type {NodePath} from "@babel/traverse";

import {ATOMIC_RUNTIME} from "./constants";
import {
	reverseClassMap,
	transformClassString,
	unhashClassString,
} from "./css";
import {isAstroFile} from "./html";
import {getCalleeName} from "./utils";
import {processArgument, processCvaCall} from "./process";
import {
	RUNTIME_FN,
	VIRTUAL_RUNTIME_IMPORT,
	isAtomicRuntimeModule,
	isReconcileWrapperName,
	shouldWrapWithRuntime,
} from "./virtual-runtime";

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
		const dir =
			cleanId.startsWith("/") || /^[a-zA-Z]:\//.test(cleanId)
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

function invalidateAtomicRuntimeModule() {
	const server = ATOMIC_RUNTIME.viteServer;
	if (!server?.moduleGraph) return;
	for (const [id, mod] of server.moduleGraph.idToModuleMap) {
		if (!mod) continue;
		if (isAtomicRuntimeModule(id)) {
			server.moduleGraph.invalidateModule(mod);
		}
	}
}

function invalidateJsModules() {
	invalidateAtomicRuntimeModule();
	const server = ATOMIC_RUNTIME.viteServer;
	if (server?.moduleGraph) {
		for (const [id, mod] of server.moduleGraph.idToModuleMap) {
			if (!mod) continue;
			if (!isJsFile(id) && !isAstroFile(id)) continue;
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
function rewriteClassValue(
	value: string,
	classMap: Record<string, string>,
	unhash: boolean,
) {
	return unhash
		? unhashClassString(value, classMap)
		: transformClassString(value, classMap);
}

function rewriteMappedClassNode(
	node: Node | null | undefined,
	classMap: Record<string, string>,
	unhash = false,
): boolean {
	if (!node) return false;

	switch (node.type) {
		case "StringLiteral": {
			const next = rewriteClassValue(node.value, classMap, unhash);
			if (next === node.value) return false;
			node.value = next;
			return true;
		}
		case "ArrayExpression": {
			let changed = false;
			for (const el of node.elements) {
				if (el && rewriteMappedClassNode(el, classMap, unhash)) changed = true;
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
				if (rewriteMappedClassNode(prop.value, classMap, unhash)) changed = true;
			}
			return changed;
		}
		case "TemplateLiteral":
			return processArgument(node, classMap);
		case "ConditionalExpression": {
			const a = rewriteMappedClassNode(node.alternate, classMap, unhash);
			const b = rewriteMappedClassNode(node.consequent, classMap, unhash);
			return a || b;
		}
		case "LogicalExpression":
			return rewriteMappedClassNode(node.right, classMap, unhash);
		case "ParenthesizedExpression":
		case "TSAsExpression":
		case "TSSatisfiesExpression":
		case "TSNonNullExpression":
		case "TSTypeAssertion":
			return rewriteMappedClassNode(
				(node as {expression: Node | null}).expression,
				classMap,
				unhash,
			);
		default:
			return false;
	}
}

function rewriteBoundClassName(
	argPath: NodePath,
	classMap: Record<string, string>,
	unhash = false,
): boolean {
	if (!argPath.isIdentifier()) return false;
	const binding = argPath.scope.getBinding(argPath.node.name);
	if (!binding?.path.isVariableDeclarator()) return false;
	const init = binding.path.node.init;
	return rewriteMappedClassNode(init, classMap, unhash);
}

function alreadyReconciled(path: NodePath) {
	const parent = path.parentPath;
	if (!parent?.isCallExpression()) return false;
	return isReconcileWrapperName(getCalleeName(parent.node.callee));
}

function isRuntimeModuleSource(value: unknown) {
	return value === VIRTUAL_RUNTIME_IMPORT;
}

function isRequireRuntimeCall(node: Node | null | undefined) {
	if (!node || node.type !== "CallExpression") return false;
	if (node.callee.type !== "Identifier" || node.callee.name !== "require") {
		return false;
	}
	const arg = node.arguments[0];
	return arg?.type === "StringLiteral" && isRuntimeModuleSource(arg.value);
}

function hasRuntimeFnBinding(ast: {program: {body: Node[]}}) {
	return ast.program.body.some((node) => {
		if (node.type === "ImportDeclaration") {
			return node.specifiers.some((spec) => spec.local?.name === RUNTIME_FN);
		}
		if (node.type === "FunctionDeclaration") {
			return node.id?.name === RUNTIME_FN;
		}
		if (node.type !== "VariableDeclaration") return false;
		return node.declarations.some((decl) => {
			if (decl.id.type === "Identifier") {
				return decl.id.name === RUNTIME_FN;
			}
			if (decl.id.type !== "ObjectPattern") return false;
			return decl.id.properties.some((prop) => {
				if (prop.type !== "ObjectProperty") return false;
				return (
					prop.value.type === "Identifier" && prop.value.name === RUNTIME_FN
				);
			});
		});
	});
}

type RuntimeImportKind = "esm" | "cjs";

function runtimeImportNode(kind: RuntimeImportKind) {
	if (kind === "cjs") {
		return t.variableDeclaration("const", [
			t.variableDeclarator(
				t.objectPattern([
					t.objectProperty(
						t.identifier("atomicReconcile"),
						t.identifier(RUNTIME_FN),
						false,
						false,
					),
				]),
				t.callExpression(t.identifier("require"), [
					t.stringLiteral(VIRTUAL_RUNTIME_IMPORT),
				]),
			),
		]);
	}

	return t.importDeclaration(
		[
			t.importSpecifier(
				t.identifier(RUNTIME_FN),
				t.identifier("atomicReconcile"),
			),
		],
		t.stringLiteral(VIRTUAL_RUNTIME_IMPORT),
	);
}

function isModuleDirectiveStatement(node: Node | undefined) {
	if (!node || node.type !== "ExpressionStatement") return false;
	if (node.expression.type !== "StringLiteral") return false;
	return (
		node.expression.value === "use client" ||
		node.expression.value === "use server" ||
		node.expression.value === "use strict"
	);
}

function runtimeImportInsertIndex(ast: {program: {body: Node[]}}) {
	let index = 0;
	while (isModuleDirectiveStatement(ast.program.body[index])) {
		index += 1;
	}
	return index;
}

function findRuntimeImportDeclaration(ast: {program: {body: Node[]}}) {
	return ast.program.body.find(
		(node): node is t.ImportDeclaration =>
			node.type === "ImportDeclaration" &&
			isRuntimeModuleSource(node.source.value),
	);
}

function findRuntimeRequireDeclarator(ast: {program: {body: Node[]}}) {
	for (const node of ast.program.body) {
		if (node.type !== "VariableDeclaration") continue;
		for (const decl of node.declarations) {
			if (isRequireRuntimeCall(decl.init)) return decl;
		}
	}
	return undefined;
}

function injectRuntimeImport(
	ast: {
		program: {body: Node[]; directives?: {value: {value: string}}[]};
	},
	kind: RuntimeImportKind,
) {
	if (hasRuntimeFnBinding(ast)) return false;

	if (kind === "esm") {
		const existing = findRuntimeImportDeclaration(ast);
		if (existing) {
			existing.specifiers.push(
				t.importSpecifier(
					t.identifier(RUNTIME_FN),
					t.identifier("atomicReconcile"),
				),
			);
			return true;
		}
	} else {
		const existing = findRuntimeRequireDeclarator(ast);
		if (existing && existing.id.type === "ObjectPattern") {
			existing.id.properties.push(
				t.objectProperty(
					t.identifier("atomicReconcile"),
					t.identifier(RUNTIME_FN),
					false,
					false,
				),
			);
			return true;
		}
	}

	ast.program.body.splice(
		runtimeImportInsertIndex(ast),
		0,
		runtimeImportNode(kind),
	);
	return true;
}

function stripRuntimeImports(ast: {program: {body: Node[]}}) {
	const body = ast.program.body;
	let removed = false;
	for (let i = body.length - 1; i >= 0; i--) {
		const node = body[i];
		if (
			node &&
			node.type === "ImportDeclaration" &&
			isRuntimeModuleSource(node.source.value)
		) {
			body.splice(i, 1);
			removed = true;
			continue;
		}
		if (node && node.type === "VariableDeclaration") {
			const next = node.declarations.filter(
				(decl) => !isRequireRuntimeCall(decl.init),
			);
			if (next.length !== node.declarations.length) {
				if (!next.length) {
					body.splice(i, 1);
				} else {
					node.declarations = next;
				}
				removed = true;
			}
		}
	}
	return removed;
}

type TransformJsOptions = {
	runtimeImport?: RuntimeImportKind | false;
	unhash?: boolean;
};

function transformJs(
	code: string,
	targetFunctions: Set<string>,
	options?: TransformJsOptions,
) {
	const unhash = options?.unhash === true;
	if (!code) return {code: null, map: null};
	if (!unhash && Object.keys(ATOMIC_RUNTIME.classMap).length === 0) {
		return {code: null, map: null};
	}

	try {
		const ast = parse(code, {
			sourceType: "module",
			plugins: ["jsx", "typescript"],
		});

		let hasModifications = false;
		let needsRuntime = false;
		const classMap = unhash
			? reverseClassMap(ATOMIC_RUNTIME.classMap)
			: ATOMIC_RUNTIME.classMap;

		traverse(ast, {
			JSXAttribute(path) {
				const attrName = path.node.name;
				const name =
					attrName.type === "JSXIdentifier" ? attrName.name : undefined;
				if (name !== "className" && name !== "class") return;

				if (path.node.value && path.node.value.type === "StringLiteral") {
					const next = rewriteClassValue(
						path.node.value.value,
						classMap,
						unhash,
					);
					if (next !== path.node.value.value) {
						path.node.value.value = next;
						hasModifications = true;
					}
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

			CallExpression: {
				enter(path) {
					const funcName = getCalleeName(path.node.callee);

					if (funcName && ATOMIC_RUNTIME.preserveFunctions.has(funcName)) {
						return;
					}

					if (funcName === "cva" && targetFunctions.has("cva")) {
						if (processCvaCall(path.node.arguments, classMap)) {
							hasModifications = true;
						}
						for (const arg of path.get("arguments")) {
							if (rewriteBoundClassName(arg, classMap, unhash)) {
								hasModifications = true;
							}
							if (!arg.isObjectExpression()) continue;
							for (const prop of arg.get("properties")) {
								if (!prop.isObjectProperty()) continue;
								const value = prop.get("value");
								if (rewriteBoundClassName(value, classMap, unhash)) {
									hasModifications = true;
								}
								if (!value.isObjectExpression()) continue;
								for (const nested of value.get("properties")) {
									if (!nested.isObjectProperty()) continue;
									if (
										rewriteBoundClassName(
											nested.get("value"),
											classMap,
											unhash,
										)
									) {
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
							if (rewriteBoundClassName(arg, classMap, unhash)) {
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
				exit(path) {
					const funcName = getCalleeName(path.node.callee);
					if (unhash) {
						if (
							isReconcileWrapperName(funcName) &&
							path.node.arguments.length === 1 &&
							path.node.arguments[0]
						) {
							path.replaceWith(path.node.arguments[0]);
							hasModifications = true;
						}
						return;
					}
					if (funcName === RUNTIME_FN) {
						needsRuntime = true;
						return;
					}
					if (!funcName || !shouldWrapWithRuntime(funcName, targetFunctions)) {
						return;
					}
					if (alreadyReconciled(path)) return;
					path.replaceWith(
						t.callExpression(t.identifier(RUNTIME_FN), [path.node]),
					);
					hasModifications = true;
					needsRuntime = true;
				},
			},

			VariableDeclarator(path) {
				if (rewriteMappedClassNode(path.node.init, classMap, unhash)) {
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
				if (rewriteMappedClassNode(path.node, classMap, unhash)) {
					hasModifications = true;
				}
			},

			ExportDefaultDeclaration(path) {
				if (rewriteMappedClassNode(path.node.declaration, classMap, unhash)) {
					hasModifications = true;
				}
			},
		});

		if (unhash && stripRuntimeImports(ast)) {
			hasModifications = true;
		}

		const runtimeImport = options?.runtimeImport ?? "esm";
		if (
			!unhash &&
			needsRuntime &&
			runtimeImport &&
			injectRuntimeImport(ast, runtimeImport)
		) {
			hasModifications = true;
		}

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

export type {TransformJsOptions};
