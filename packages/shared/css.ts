import postcss from "postcss";
import {createRequire} from "node:module";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import type {
	AcceptedPlugin,
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

import {findMonorepoRoot} from "./workspace";
import {process_tailwind_css} from "../core/wasm";
import postcssTailwindAtomic from "../postcss";

const ATOMIC_MAP_COMMENT_RE =
	/\/\*! tailwind-atomic-map\s+([A-Za-z0-9+/]+=*)\s*\*\//;

const TAILWIND_SASS_LAYER_RE =
	/@(?:use|import|reference)\s+(['"])tailwindcss\/(base|components|utilities|preflight)\1(?:\s+as\s+(?:\*|[\w-]+))?\s*;?/gi;

const SASS_MODULE_RULE_RE = /@(?:use|forward)\s+[^;]*;/g;

type NodeRequireLike = {
	(id: string): unknown;
	resolve?: (id: string) => string;
};

type TailwindV4Source = {
	base: string;
	pattern: string;
	negated?: boolean;
};

type TailwindV4Compiler = {
	root: "none" | null | TailwindV4Source;
	sources?: TailwindV4Source[];
	build: (candidates: string[]) => string;
};

type TailwindV4Scanner = {
	scan: () => string[];
};

function hasTailwindDirectives(css: string) {
	return TAILWIND_DIRECTIVE_RE.test(css);
}

function isViteCssJsWrapper(code: string) {
	return (
		code.includes("import.meta") ||
		code.includes("updateStyle") ||
		/^\s*(?:import|export)\b/.test(code)
	);
}

function unwrapModule(mod: unknown): unknown {
	if (mod && typeof mod === "object" && "default" in mod) {
		const def = (mod as {default: unknown}).default;
		if (def != null) return def;
	}
	return mod;
}

function asPostcssPlugin(mod: unknown): unknown | undefined {
	if (mod == null) return undefined;
	const plugin = unwrapModule(mod) ?? mod;
	if (typeof plugin === "function") {
		return (plugin as {postcss?: boolean}).postcss === true
			? plugin
			: undefined;
	}
	if (
		typeof plugin === "object" &&
		plugin !== null &&
		"postcssPlugin" in plugin
	) {
		return plugin;
	}
	return undefined;
}

function tryRequire(appRequire: NodeRequireLike, id: string): unknown {
	try {
		return appRequire(id);
	} catch {
		return undefined;
	}
}

function requireFromGraph(
	appRequire: NodeRequireLike,
	id: string,
	via: string[],
): unknown {
	const direct = tryRequire(appRequire, id);
	if (direct !== undefined) return direct;

	for (const parent of via) {
		try {
			const parentId = appRequire.resolve?.(parent);
			if (!parentId) continue;
			return createRequire(parentId)(id);
		} catch {
			continue;
		}
	}
	return undefined;
}

async function compileTailwindV4Css(
	source: string,
	cssPath: string,
	pkgDir: string,
	appRequire: NodeRequireLike,
): Promise<string | undefined> {
	const nodeMod = requireFromGraph(appRequire, "@tailwindcss/node", [
		"@tailwindcss/vite",
		"@tailwindcss/postcss",
		"tailwindcss",
	]) as
		| {
				compile?: (
					css: string,
					opts: {
						base: string;
						from?: string;
						onDependency: (file: string) => void;
					},
				) => Promise<TailwindV4Compiler>;
				default?: {
					compile?: (
						css: string,
						opts: {
							base: string;
							from?: string;
							onDependency: (file: string) => void;
						},
					) => Promise<TailwindV4Compiler>;
				};
		  }
		| undefined;
	const compile = nodeMod?.compile ?? nodeMod?.default?.compile;
	if (typeof compile !== "function") return undefined;

	try {
		const compiler = await compile(source, {
			base: path.dirname(cssPath),
			from: cssPath,
			onDependency() {},
		});
		if (!compiler || typeof compiler.build !== "function") return undefined;

		let candidates: string[] = [];
		const oxide = requireFromGraph(appRequire, "@tailwindcss/oxide", [
			"@tailwindcss/node",
			"@tailwindcss/vite",
			"tailwindcss",
		]) as
			| {Scanner?: new (opts: {sources: TailwindV4Source[]}) => TailwindV4Scanner}
			| undefined;
		const Scanner = oxide?.Scanner;
		if (typeof Scanner === "function") {
			const sources: TailwindV4Source[] =
				compiler.root === "none"
					? []
					: compiler.root === null
						? [{base: pkgDir, pattern: "**/*", negated: false}]
						: [{...compiler.root, negated: false}];
			const scanner = new Scanner({
				sources: sources.concat(compiler.sources ?? []),
			});
			candidates = scanner.scan();
		}

		const css = compiler.build(candidates);
		return typeof css === "string" ? css : undefined;
	} catch {
		return undefined;
	}
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

const VARIANT_PSEUDOS = new Set([
	"hover",
	"focus",
	"active",
	"disabled",
	"visited",
	"focus-within",
	"focus-visible",
	"checked",
	"required",
	"optional",
	"valid",
	"invalid",
	"first",
	"last",
	"odd",
	"even",
	"empty",
	"target",
	"enabled",
	"indeterminate",
	"default",
	"open",
	"autofill",
	"placeholder-shown",
	"read-only",
	"pressed",
]);

function unescapeCssClassName(value: string) {
	return value
		.replace(/\\([^\n\r\f0-9a-fA-F])/g, "$1")
		.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g, (_, hex: string) => {
			const code = Number.parseInt(hex, 16);
			return Number.isFinite(code) ? String.fromCodePoint(code) : "";
		});
}

function stripRedundantVariantPseudo(key: string) {
	const lastColon = key.lastIndexOf(":");
	if (lastColon <= 0) return key;
	const pseudo = key.slice(lastColon + 1);
	if (!VARIANT_PSEUDOS.has(pseudo)) return key;
	const rest = key.slice(0, lastColon);
	if (
		rest === pseudo ||
		rest.startsWith(`${pseudo}:`) ||
		rest.includes(`:${pseudo}:`) ||
		rest.endsWith(`:${pseudo}`)
	) {
		return rest;
	}
	return key;
}

function normalizeArbitraryHex(key: string) {
	return key.replace(
		/\[#([0-9a-fA-F]+)\]/g,
		(_match, hex: string) => `[#${hex.toLowerCase()}]`,
	);
}

function normalizeUtilityClassName(value: string) {
	return normalizeArbitraryHex(
		stripRedundantVariantPseudo(unescapeCssClassName(value)),
	);
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
		const key = normalizeUtilityClassName(rawKey);
		if (!key) continue;
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

/**
 * Utilidades Tailwind típicas (`.flex`, `.py-2`, `.hover\:bg-red-500:hover`, `--tw-*`).
 * No: tokens de skin (`.pokerenchile { --color-*: … }`), componentes SCSS
 * (`.a .b`, `.pattern-background::before`) ni `:root` / `html` / `[data-theme]`.
 * Multi-decl (`py-2`, `px-4`, `mx-auto`) SÍ son utilidades; no usar decls.length.
 */
function isUtilityRule(node: ChildNode): node is PostcssRule {
	if (node.type !== "rule") return false;
	if (!String(node.selector).includes(".")) return false;
	if (hasThemeCustomProperties(node)) return false;
	if (hasNestedChildRules(node)) return false;
	if (!isUtilitySelector(node.selector)) return false;
	return true;
}

function isHashedAtomicSelector(selector: string) {
	return /(?:^|[\s,+>~])\._[0-9a-f]{6}\b/i.test(selector);
}

function atomicizeUtilityNodes(container: PostcssRoot) {
	if (!container.nodes) return false;

	const utilityNodes = container.nodes.filter(isUtilityRule);
	if (!utilityNodes.length) return false;

	const utilityCss = utilityNodes.map((node) => node.toString()).join("\n");
	const {class_map, css_rules} = process_tailwind_css(utilityCss);
	const mapChanged = mergeClassMap(class_map);

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

function atomicizeContainer(container: PostcssRoot) {
	if (!container.nodes) return false;

	let mapChanged = atomicizeUtilityNodes(container);

	for (const node of [...container.nodes]) {
		if (node.type === "atrule" && NESTED_AT_RULES.has(node.name)) {
			if (atomicizeContainer(node as unknown as PostcssRoot)) mapChanged = true;
		}
	}

	return mapChanged;
}

function dedupeAtomicRules(root: PostcssRoot) {
	function walk(container: PostcssRoot, scope: string) {
		const local = new Set<string>();
		for (const node of [...(container.nodes ?? [])]) {
			if (node.type === "rule" && isHashedAtomicSelector(node.selector)) {
				const key = node.toString().replace(/\s+/g, " ").trim();
				const scoped = `${scope}\0${key}`;
				if (local.has(key) || seenGlobal.has(scoped)) {
					node.remove();
					continue;
				}
				local.add(key);
				seenGlobal.add(scoped);
			} else if (
				node.type === "atrule" &&
				NESTED_AT_RULES.has(node.name)
			) {
				walk(node as unknown as PostcssRoot, `${scope}@${node.name} ${node.params}`);
			}
		}
	}
	const seenGlobal = new Set<string>();
	walk(root, "");
}

function lookupMappedClass(cls: string, classMap: Record<string, string>) {
	return (
		classMap[cls] ||
		classMap[unescapeCssClassName(cls)] ||
		classMap[normalizeUtilityClassName(cls)]
	);
}

function transformClassString(
	classStr: string,
	classMap: Record<string, string>,
) {
	if (!classStr) return classStr;
	return classStr
		.split(/[\s"']+/)
		.filter(Boolean)
		.map((cls) => lookupMappedClass(cls, classMap) || cls)
		.join(" ");
}

function posixCssPath(from: string) {
	return from.split("?")[0]?.replace(/\\/g, "/") ?? "";
}

const NODE_MODULES_PATH_RE = /(?:^|\/)node_modules(?:\/|$)/;

function matchesIgnoreCssPattern(clean: string, original: string, pattern: string | RegExp) {
	if (typeof pattern === "string") {
		const needle = pattern.replace(/\\/g, "/");
		return clean.includes(needle) || original.includes(pattern);
	}
	pattern.lastIndex = 0;
	return pattern.test(clean) || pattern.test(original);
}

/**
 * CSS de terceros (slick, fontawesome, cualquier node_modules) no se atomiciza:
 * el JS vendor sigue usando clases literales en runtime.
 */
function shouldIgnoreCss(from?: string | null) {
	if (!from) return false;
	const clean = posixCssPath(from);
	if (!clean) return false;
	if (NODE_MODULES_PATH_RE.test(clean)) return true;
	for (const pattern of ATOMIC_RUNTIME.ignoreCss) {
		if (matchesIgnoreCssPattern(clean, from, pattern)) return true;
	}
	return false;
}

function classMapFilePath() {
	if (ATOMIC_RUNTIME.classMapFile === false) return undefined;
	if (typeof ATOMIC_RUNTIME.classMapFile === "string" && ATOMIC_RUNTIME.classMapFile) {
		return ATOMIC_RUNTIME.classMapFile;
	}
	const root =
		ATOMIC_RUNTIME.projectRoots[0] ||
		process.env["TAILWIND_ATOMIC_PROJECT_ROOT"] ||
		process.cwd();
	if (!root) return undefined;
	return path.join(root, "node_modules", ".cache", "tailwindcss-atomic", "class-map.json");
}

function persistClassMap() {
	const file = classMapFilePath();
	if (!file) return;
	try {
		mkdirSync(path.dirname(file), {recursive: true});
		writeFileSync(file, JSON.stringify(toPlainMap(ATOMIC_RUNTIME.classMap), null, 2));
	} catch {
		// Cache is optional; a missing node_modules should not fail the build.
	}
}

function loadPersistedClassMap() {
	const file = classMapFilePath();
	if (!file) return false;
	try {
		if (!existsSync(file)) return false;
		const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
		return mergeClassMap(parsed as Record<string, string>);
	} catch {
		return false;
	}
}

/**
 * Corre el WASM sobre la hoja completa cuando el crate devuelve `css`.
 * Conserva `@theme`, `:root`, preflight, bloques de tokens de skin
 * (`.pokerenchile { --color-*: … }`), componentes SCSS, `@keyframes` y `@media`.
 * Si el mock de tests no envía `css`, se usa el filtrado JS + `css_rules`.
 */
function applyAtomicCss(css: string, from?: string) {
	if (!css) {
		return {code: css, changed: false};
	}

	if (shouldIgnoreCss(from)) {
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
		const wasmResult = process_tailwind_css(css) as {
			class_map?: Record<string, string>;
			css_rules?: unknown;
			css?: string;
			changed?: boolean;
		};

		if (typeof wasmResult?.css === "string") {
			if (!wasmResult.changed && !wasmResult.css.trim()) {
				return {code: css, changed: false};
			}
			const mapChanged = mergeClassMap(wasmResult.class_map ?? {});
			if (!wasmResult.changed && !mapChanged) {
				return {code: css, changed: false, mapChanged};
			}
			if (mapChanged) persistClassMap();
			return {
				code: formatAtomicCss(wasmResult.css),
				changed: true,
				mapChanged: classMapChangedSince(prev) || mapChanged,
			};
		}

		const root = postcss.parse(css);
		flattenLayerAtRules(root);
		const changed = atomicizeContainer(root);
		if (!changed) {
			return {code: css, changed: false};
		}

		dedupeAtomicRules(root);
		const mapChanged = classMapChangedSince(prev);
		if (mapChanged) persistClassMap();
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
	const projectRoot = process.env["TAILWIND_ATOMIC_PROJECT_ROOT"];
	const starts = [
		projectRoot,
		...ATOMIC_RUNTIME.projectRoots,
		process.env["INIT_CWD"],
		projectRoot ? undefined : process.cwd(),
	].filter((dir): dir is string => Boolean(dir));

	const bases: string[] = [];
	const seen = new Set<string>();
	const ceiling = findMonorepoRoot(resolve(starts[0] ?? process.cwd()));
	const ceilingKey = ceiling.replace(/\\/g, "/").toLowerCase();

	for (const start of starts) {
		let dir = resolve(start);
		const {root} = parse(dir);
		for (let i = 0; i < 8; i++) {
			const key = dir.replace(/\\/g, "/").toLowerCase();
			if (!seen.has(key)) {
				seen.add(key);
				bases.push(dir);
			}
			if (dir === root || key === ceilingKey) break;
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}

	return bases;
}

function findCssEntries(
	existsSync: (path: string) => boolean,
	readdirSync: (path: string) => string[],
	statSync: (path: string) => {isDirectory(): boolean},
	resolve: (...paths: string[]) => string,
	join: (...paths: string[]) => string,
	dirname: (path: string) => string,
	parse: (path: string) => {root: string},
) {
	const bases = collectSearchRoots(resolve, dirname, parse);
	const found: string[] = [];
	const seen = new Set<string>();

	function add(abs: string) {
		const key = abs.replace(/\\/g, "/").toLowerCase();
		if (seen.has(key) || !existsSync(abs)) return;
		seen.add(key);
		found.push(abs);
	}

	for (const rel of ATOMIC_RUNTIME.cssEntries) {
		if (!rel) continue;
		if (/^(?:[a-zA-Z]:)?[\\/]/.test(rel)) {
			add(rel);
			continue;
		}
		for (const base of bases) add(resolve(base, rel));
	}

	for (const base of bases) {
		for (const rel of CSS_ENTRY_CANDIDATES) {
			add(resolve(base, rel));
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

	function walk(dir: string, depth: number) {
		if (depth > 6) return;
		for (const rel of CSS_ENTRY_CANDIDATES) {
			add(resolve(dir, rel));
		}
		if (found.length >= 12) return;
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
			walk(full, depth + 1);
			if (found.length >= 12) return;
		}
	}

	for (const base of bases) {
		walk(base, 0);
		if (found.length >= 12) break;
	}

	return found;
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
	return findCssEntries(
		existsSync,
		readdirSync,
		statSync,
		resolve,
		join,
		dirname,
		parse,
	)[0];
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

async function warmupCssFile(
	cssPath: string,
	existsSync: (path: string) => boolean,
	join: (...paths: string[]) => string,
	dirname: (path: string) => string,
	parse: (path: string) => {root: string},
) {
	const pkgDir = findNearestPackageDir(
		dirname(cssPath),
		existsSync,
		join,
		dirname,
		parse,
	);
	const {readFileSync} = await import("node:fs");
	const source = readFileSync(cssPath, "utf8");
	const appRequire = createRequire(join(pkgDir, "package.json"));
	const prepared = prepareWarmupSource(cssPath, source, appRequire);

	try {
		const loadConfig = appRequire("postcss-load-config") as (
			ctx?: unknown,
			dir?: string,
		) => Promise<{plugins?: unknown[]}>;
		const loaded = await loadConfig({}, pkgDir);
		if (Array.isArray(loaded?.plugins) && loaded.plugins.length) {
			await postcss(loaded.plugins as AcceptedPlugin[]).process(prepared, {
				from: cssPath,
			});
			if (Object.keys(ATOMIC_RUNTIME.classMap).length > 0) return;
			if (!hasTailwindDirectives(prepared)) return;
		}
	} catch {
		// El app puede no tener postcss-load-config; armamos el pipeline a mano.
		// También caemos aquí si el config trae `tailwindcss` v4 (ya no es plugin de PostCSS).
	}

	const twPostcss = asPostcssPlugin(
		tryRequire(appRequire, "@tailwindcss/postcss"),
	);
	if (twPostcss) {
		const plugins = [twPostcss];
		const autoprefixer = asPostcssPlugin(
			tryRequire(appRequire, "autoprefixer"),
		);
		if (autoprefixer) plugins.push(autoprefixer);
		plugins.push(postcssTailwindAtomic());
		await postcss(plugins as AcceptedPlugin[]).process(prepared, {
			from: cssPath,
		});
		return;
	}

	// Vite + `@tailwindcss/vite`: no hay plugin de PostCSS. Compilamos con
	// `@tailwindcss/node` (dependencia transitiva) y atomicizamos el CSS expandido.
	const compiled = await compileTailwindV4Css(
		prepared,
		cssPath,
		pkgDir,
		appRequire,
	);
	if (compiled) {
		applyAtomicCss(compiled, cssPath);
		return;
	}

	const twV3 = asPostcssPlugin(tryRequire(appRequire, "tailwindcss"));
	if (!twV3) return;

	const plugins = [twV3];
	const autoprefixer = asPostcssPlugin(tryRequire(appRequire, "autoprefixer"));
	if (autoprefixer) plugins.push(autoprefixer);
	plugins.push(postcssTailwindAtomic());
	await postcss(plugins as AcceptedPlugin[]).process(prepared, {from: cssPath});
}

async function compileCssEntryForAtomic(cssPath: string, source: string) {
	const {existsSync} = await import("node:fs");
	const {join, dirname, parse} = await import("node:path");
	const pkgDir = findNearestPackageDir(
		dirname(cssPath),
		existsSync,
		join,
		dirname,
		parse,
	);
	const appRequire = createRequire(join(pkgDir, "package.json"));
	const prepared = prepareWarmupSource(cssPath, source, appRequire);
	return compileTailwindV4Css(prepared, cssPath, pkgDir, appRequire);
}

async function runWarmup() {
	const {existsSync, readdirSync, statSync} = await import("node:fs");
	const {resolve, join, dirname, parse} = await import("node:path");

	const cssPaths = findCssEntries(
		existsSync,
		readdirSync,
		statSync,
		resolve,
		join,
		dirname,
		parse,
	);
	if (!cssPaths.length) return;

	let failures = 0;
	let lastError: unknown;
	for (const cssPath of cssPaths) {
		try {
			await warmupCssFile(cssPath, existsSync, join, dirname, parse);
		} catch (error) {
			failures += 1;
			lastError = error;
		}
	}
	if (failures === cssPaths.length && lastError) {
		throw lastError;
	}
}

async function warmupClassMapFromCss() {
	if (Object.keys(ATOMIC_RUNTIME.classMap).length > 0) return;
	loadPersistedClassMap();
	// A persisted map can be incomplete (first CSS file only). Always warm
	// remaining entries so monorepo skins and later utilities are included.
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
	isViteCssJsWrapper,
	asPostcssPlugin,
	compileTailwindV4Css,
	compileCssEntryForAtomic,
	mergeClassMap,
	applyAtomicCss,
	atomicizeContainer,
	isUtilityRule,
	normalizeUtilityClassName,
	shouldIgnoreCss,
	transformClassString,
	warmupClassMapFromCss,
	collectSearchRoots,
	findCssEntry,
	findCssEntries,
	findNearestPackageDir,
	normalizeTailwindSassDirectives,
	stripSassModuleRules,
	prepareWarmupSource,
	rehydrateClassMapFromCss,
	persistClassMap,
	loadPersistedClassMap,
};
