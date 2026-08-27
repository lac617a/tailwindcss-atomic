import postcss from "postcss";
import {createRequire} from "node:module";
import type {
	ChildNode,
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

function isUtilityRule(node: ChildNode): node is PostcssRule {
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
	const appRequire = createRequire(join(pkgDir, "package.json"));
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
	transformClassString,
	warmupClassMapFromCss,
};
