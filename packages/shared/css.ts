import postcss from "postcss";
import {createRequire} from "node:module";
import path from "node:path";
import {pathToFileURL} from "node:url";
import type {
	ChildNode,
	Declaration as PostcssDeclaration,
	Root as PostcssRoot,
	Rule as PostcssRule,
} from "postcss";

import {
	ATOMIC_MARKER,
	ATOMIC_RUNTIME,
	NESTED_AT_RULES,
	CSS_ENTRY_CANDIDATES,
	TAILWIND_DIRECTIVE_RE,
} from "./constants";

import {process_tailwind_css} from "../core/wasm";
import postcssTailwindAtomic from "../postcss";

const ATOMIC_MAP_COMMENT_RE =
	/\/\*! tailwind-atomic-map\s+([A-Za-z0-9+/]+=*)\s*\*\//;

const TAILWIND_SASS_LAYER_RE =
	/@(?:use|import|reference)\s+(['"])tailwindcss\/(base|components|utilities|preflight)\1(?:\s+as\s+(?:\*|[\w-]+))?\s*;?/gi;

const SASS_MODULE_RULE_RE = /@(?:use|forward)\s+[^;]*;/g;

type NodeRequireLike = (id: string) => unknown;

function hasTailwindDirectives(css: string) {
	return TAILWIND_DIRECTIVE_RE.test(css);
}

function isAlreadyAtomic(css: string) {
	return css.includes(ATOMIC_MARKER);
}

function isSassFile(cssPath: string) {
	const clean = cssPath.split("?")[0] ?? "";
	return /\.s[ac]ss$/i.test(clean);
}

/**
 * Tailwind v3 no expande `@use 'tailwindcss/utilities'`; espera `@tailwind utilities`.
 * Lo mismo para `@import` / `@reference` de las capas clásicas.
 */
function normalizeTailwindSassDirectives(css: string) {
	TAILWIND_SASS_LAYER_RE.lastIndex = 0;
	return css.replace(TAILWIND_SASS_LAYER_RE, (_match, _quote, layer) => {
		const name = String(layer).toLowerCase();
		if (name === "preflight" || name === "base") return "@tailwind base;";
		return `@tailwind ${name};`;
	});
}

function stripSassModuleRules(css: string) {
	SASS_MODULE_RULE_RE.lastIndex = 0;
	return css.replace(SASS_MODULE_RULE_RE, "");
}

function loadSass(appRequire: NodeRequireLike) {
	try {
		return appRequire("sass") as {
			compileString?: (
				src: string,
				opts?: unknown,
			) => {css?: string | {toString(): string}};
			default?: {
				compileString?: (
					src: string,
					opts?: unknown,
				) => {css?: string | {toString(): string}};
			};
		};
	} catch {
		try {
			return appRequire("sass-embedded") as {
				compileString?: (
					src: string,
					opts?: unknown,
				) => {css?: string | {toString(): string}};
				default?: {
					compileString?: (
						src: string,
						opts?: unknown,
					) => {css?: string | {toString(): string}};
				};
			};
		} catch {
			return undefined;
		}
	}
}

function tryCompileSass(
	cssPath: string,
	source: string,
	appRequire: NodeRequireLike,
) {
	if (!isSassFile(cssPath)) return source;

	const sassMod = loadSass(appRequire);
	const compileString =
		sassMod?.compileString ?? sassMod?.default?.compileString;
	if (typeof compileString !== "function") return source;

	try {
		const result = compileString(source, {
			url: pathToFileURL(cssPath),
			loadPaths: [path.dirname(cssPath)],
			quietDeps: true,
		});
		if (result?.css != null) return String(result.css);
	} catch {
		// Peer opcional: si Sass no resuelve, seguimos con el CSS normalizado.
	}

	return source;
}

function prepareWarmupSource(
	cssPath: string,
	source: string,
	appRequire: NodeRequireLike,
) {
	const normalized = normalizeTailwindSassDirectives(source);
	const compiled = tryCompileSass(cssPath, normalized, appRequire);
	return stripSassModuleRules(compiled);
}

function encodeClassMap(classMap: Record<string, string>) {
	return Buffer.from(JSON.stringify(toPlainMap(classMap)), "utf8").toString(
		"base64",
	);
}

function formatAtomicCss(rootCss: string) {
	const plain = toPlainMap(ATOMIC_RUNTIME.classMap);
	if (!Object.keys(plain).length) {
		return `${ATOMIC_MARKER}\n${rootCss}`;
	}
	return `${ATOMIC_MARKER}\n/*! tailwind-atomic-map ${encodeClassMap(plain)} */\n${rootCss}`;
}

function rehydrateClassMapFromCss(css: string) {
	ATOMIC_MAP_COMMENT_RE.lastIndex = 0;
	const match = ATOMIC_MAP_COMMENT_RE.exec(css);
	if (!match?.[1]) return false;
	try {
		const json = Buffer.from(match[1], "base64").toString("utf8");
		const parsed = JSON.parse(json) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return false;
		}
		return mergeClassMap(parsed as Record<string, string>);
	} catch {
		return false;
	}
}

function classMapChangedSince(prev: Record<string, string>) {
	const next = ATOMIC_RUNTIME.classMap;
	for (const key of Object.keys(next)) {
		if (prev[key] !== next[key]) return true;
	}
	for (const key of Object.keys(prev)) {
		if (!(key in next)) return true;
	}
	return false;
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

const TAILWIND_INTERNAL_PROP_RE = /^--tw-/;

const TAILWIND_PSEUDO_ELEMENT_RE =
	/::(?:-webkit-input-placeholder|placeholder|file-selector-button|marker|backdrop|first-line|first-letter|selection)\b/g;

const TAILWIND_SPACE_DIVIDE_RE =
	/^\.(?:\\.|[^\s>+~])+\s*>\s*:not\(\[hidden\]\)\s*~\s*:not\(\[hidden\]\)$/;

function declsOf(node: PostcssRule): PostcssDeclaration[] {
	return (node.nodes ?? []).filter(
		(child): child is PostcssDeclaration => child.type === "decl",
	);
}

function hasThemeCustomProperties(node: PostcssRule) {
	return declsOf(node).some(
		(decl) =>
			decl.prop.startsWith("--") && !TAILWIND_INTERNAL_PROP_RE.test(decl.prop),
	);
}

function hasNestedChildRules(node: PostcssRule) {
	return (node.nodes ?? []).some(
		(child) => child.type === "rule" || child.type === "atrule",
	);
}

function hasTailwindVariantEscape(selector: string) {
	return selector.includes("\\:");
}

function isDocumentOrThemeRootSelector(selector: string) {
	const sel = selector.trim();
	return (
		/^(?:html|body|:root)\b/.test(sel) || /\[data-theme\b/.test(sel)
	);
}

function isTailwindSpaceOrDivideSelector(selector: string) {
	return TAILWIND_SPACE_DIVIDE_RE.test(selector.trim());
}

function hasComponentPseudoElement(selector: string) {
	if (!selector.includes("::")) return false;
	if (hasTailwindVariantEscape(selector)) return false;
	TAILWIND_PSEUDO_ELEMENT_RE.lastIndex = 0;
	return selector.replace(TAILWIND_PSEUDO_ELEMENT_RE, "").includes("::");
}

function hasNonUtilityCombinator(selector: string) {
	if (isTailwindSpaceOrDivideSelector(selector)) return false;
	const normalized = selector.replace(/\\./g, "").replace(/\([^)]*\)/g, "()");
	return /[\s>+~]/.test(normalized);
}

function countUnescapedClasses(selector: string) {
	return selector.match(/(?<!\\)\.(?:\\.|[^\s.:#[\]>+~,])+/g)?.length ?? 0;
}

function isSingleUtilitySelector(selector: string) {
	const sel = selector.trim();
	if (!sel.includes(".")) return false;

	if (isTailwindSpaceOrDivideSelector(sel)) return true;

	const hasVariant = hasTailwindVariantEscape(sel);
	if (!hasVariant) {
		if (isDocumentOrThemeRootSelector(sel)) return false;
		if (hasComponentPseudoElement(sel)) return false;
		if (hasNonUtilityCombinator(sel)) return false;
		if (countUnescapedClasses(sel) !== 1) return false;
	}

	return true;
}

function isUtilitySelector(selector: string) {
	const parts = postcss.list.comma(selector).map((part) => part.trim());
	if (!parts.length) return false;
	return parts.every(isSingleUtilitySelector);
}

function isComponentLikeSimpleRule(node: PostcssRule) {
	const selector = String(node.selector);
	if (hasTailwindVariantEscape(selector)) return false;
	if (isTailwindSpaceOrDivideSelector(selector)) return false;

	const decls = declsOf(node);
	if (decls.length <= 1) return false;
	if (decls.some((decl) => TAILWIND_INTERNAL_PROP_RE.test(decl.prop))) {
		return false;
	}
	return true;
}

/**
 * Utilidades Tailwind típicas (`.flex`, `.hover\:bg-red-500:hover`, `--tw-*`).
 * No: tokens de skin (`.pokerenchile { --color-*: … }`), componentes SCSS
 * (`.a .b`, `.pattern-background::before`) ni `:root` / `html` / `[data-theme]`.
 */
function isUtilityRule(node: ChildNode): node is PostcssRule {
	if (node.type !== "rule") return false;
	if (!String(node.selector).includes(".")) return false;
	if (hasThemeCustomProperties(node)) return false;
	if (hasNestedChildRules(node)) return false;
	if (!isUtilitySelector(node.selector)) return false;
	if (isComponentLikeSimpleRule(node)) return false;
	return true;
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
	if (!first) return mapChanged;

	for (const atomicNode of parsed.nodes ?? []) {
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
 * Conserva `@theme`, `:root`, preflight, bloques de tokens de skin
 * (`.pokerenchile { --color-*: … }`), componentes SCSS, `@keyframes` y `@media`.
 */
function applyAtomicCss(css: string) {
	if (!css) {
		return {code: css, changed: false};
	}

	if (isAlreadyAtomic(css)) {
		const mapChanged = rehydrateClassMapFromCss(css);
		return {code: css, changed: false, mapChanged};
	}

	if (hasTailwindDirectives(css)) {
		return {code: css, changed: false};
	}

	try {
		const prev = {...ATOMIC_RUNTIME.classMap};
		const root = postcss.parse(css);
		flattenLayerAtRules(root);
		const changed = atomicizeContainer(root);
		if (!changed) {
			return {code: css, changed: false};
		}

		const mapChanged = classMapChangedSince(prev);
		return {
			code: formatAtomicCss(root.toString()),
			changed: true,
			mapChanged,
		};
	} catch {
		return {code: css, changed: false};
	}
}

function isCssFile(id: string) {
	const cleanId = id.split("?")[0]?.replace(/\\/g, "/");

	if (!cleanId) return false;

	if (/\.module\.(css|scss|sass|less|styl|pcss|postcss)$/.test(cleanId))
		return false;

	return /\.(css|scss|sass|less|styl|pcss|postcss)$/.test(cleanId);
}

let warmupPromise: Promise<unknown> | undefined;

function collectSearchRoots(
	resolve: (...paths: string[]) => string,
	dirname: (path: string) => string,
	parse: (path: string) => {root: string},
) {
	const starts = [
		process.env["TAILWIND_ATOMIC_PROJECT_ROOT"],
		...ATOMIC_RUNTIME.projectRoots,
		process.cwd(),
		process.env["INIT_CWD"],
	].filter((dir): dir is string => Boolean(dir));

	const bases: string[] = [];
	const seen = new Set<string>();

	for (const start of starts) {
		let dir = resolve(start);
		const {root} = parse(dir);
		for (let i = 0; i < 8; i++) {
			const key = dir.replace(/\\/g, "/").toLowerCase();
			if (!seen.has(key)) {
				seen.add(key);
				bases.push(dir);
			}
			if (dir === root) break;
			dir = dirname(dir);
		}
	}

	return bases;
}

function findCssEntry(
	existsSync: (path: string) => boolean,
	readdirSync: (path: string) => string[],
	statSync: (path: string) => {isDirectory(): boolean},
	resolve: (...paths: string[]) => string,
	join: (...paths: string[]) => string,
	dirname: (path: string) => string,
	parse: (path: string) => {root: string},
) {
	const bases = collectSearchRoots(resolve, dirname, parse);

	for (const base of bases) {
		for (const rel of CSS_ENTRY_CANDIDATES) {
			const abs = resolve(base, rel);
			if (existsSync(abs)) return abs;
		}
	}

	const skip = new Set([
		"node_modules",
		".next",
		".git",
		"dist",
		"pkg",
		"target",
		".turbo",
	]);

	function walk(dir: string, depth: number): string | undefined {
		if (depth > 3) return;
		let names: string[];
		try {
			names = readdirSync(dir);
		} catch {
			return;
		}

		for (const name of names) {
			if (skip.has(name)) continue;
			const full = join(dir, name);
			try {
				if (!statSync(full).isDirectory()) continue;
			} catch {
				continue;
			}

			for (const rel of CSS_ENTRY_CANDIDATES) {
				const abs = resolve(full, rel);
				if (existsSync(abs)) return abs;
			}

			const nested = walk(full, depth + 1);
			if (nested) return nested;
		}
	}

	for (const base of bases) {
		const found = walk(base, 0);
		if (found) return found;
	}
}

function findNearestPackageDir(
	startDir: string,
	existsSync: (path: string) => boolean,
	join: (...paths: string[]) => string,
	dirname: (path: string) => string,
	parse: (path: string) => {root: string},
) {
	let dir = startDir;
	const {root} = parse(dir);
	while (true) {
		if (existsSync(join(dir, "package.json"))) return dir;
		if (dir === root) return startDir;
		dir = dirname(dir);
	}
}

async function runWarmup() {
	const {existsSync, readFileSync, readdirSync, statSync} = await import(
		"node:fs"
	);
	const {resolve, join, dirname, parse} = await import("node:path");

	const cssPath = findCssEntry(
		existsSync,
		readdirSync,
		statSync,
		resolve,
		join,
		dirname,
		parse,
	);
	if (!cssPath) return;

	const pkgDir = findNearestPackageDir(
		dirname(cssPath),
		existsSync,
		join,
		dirname,
		parse,
	);
	const source = readFileSync(cssPath, "utf8");
	const appRequire = createRequire(join(pkgDir, "package.json"));
	const prepared = prepareWarmupSource(cssPath, source, appRequire);
	const plugins = [];
	try {
		const loadConfig = appRequire("postcss-load-config");
		const loaded = await loadConfig({}, pkgDir);
		if (Array.isArray(loaded?.plugins) && loaded.plugins.length) {
			await postcss(loaded.plugins).process(prepared, {from: cssPath});
			if (Object.keys(ATOMIC_RUNTIME.classMap).length > 0) return;
			// Config ran but Tailwind no expandió (p.ej. @use sin normalizar).
			// Si ya no quedan directivas, no rehacemos el pipeline.
			if (!hasTailwindDirectives(prepared)) return;
		}
	} catch {
		// El app puede no tener postcss-load-config; armamos el pipeline a mano.
	}

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

	try {
		plugins.push(appRequire("autoprefixer"));
	} catch {
		// Tailwind v4 no lo necesita.
	}

	plugins.push(postcssTailwindAtomic());
	await postcss(plugins).process(prepared, {from: cssPath});
}

async function warmupClassMapFromCss() {
	if (Object.keys(ATOMIC_RUNTIME.classMap).length > 0) return;
	if (warmupPromise) return warmupPromise;

	warmupPromise = runWarmup()
		.catch((error) => {
			console.warn("[tailwind-atomic] warmup failed:", error);
		})
		.finally(() => {
			if (Object.keys(ATOMIC_RUNTIME.classMap).length === 0) {
				warmupPromise = undefined;
			}
		});

	return warmupPromise;
}

export {
	isCssFile,
	mergeClassMap,
	applyAtomicCss,
	atomicizeContainer,
	isUtilityRule,
	transformClassString,
	warmupClassMapFromCss,
	collectSearchRoots,
	findCssEntry,
	findNearestPackageDir,
	normalizeTailwindSassDirectives,
	stripSassModuleRules,
	prepareWarmupSource,
	rehydrateClassMapFromCss,
};
