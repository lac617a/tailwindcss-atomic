import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import path from "node:path";

import {ATOMIC_RUNTIME} from "./constants";

/** Package subpath — Turbopack treats `virtual:` as an unsupported external. */
const VIRTUAL_RUNTIME_IMPORT = "tailwindcss-atomic/runtime";
const VIRTUAL_RUNTIME_RESOLVED = "\0tailwind-atomic-runtime";
const RUNTIME_FN = "_twAtomicReconcile";

function posixId(id: string) {
	return String(id).split("?")[0]?.replace(/\\/g, "/") ?? "";
}

function decodeUriComponentSafe(value: string) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/**
 * Ids that `load` / `loadInclude` may serve. Webpack/Rspack encode `\0` virtual
 * modules as `path.resolve(context, "_virtual_") + encodeURIComponent(id)`.
 */
function isVirtualRuntimeLoadId(id: string) {
	const clean = posixId(id);
	if (!clean) return false;
	if (clean === VIRTUAL_RUNTIME_RESOLVED) return true;

	const encoded = encodeURIComponent(VIRTUAL_RUNTIME_RESOLVED);
	if (
		clean.endsWith(`_virtual_${encoded}`) ||
		clean.endsWith(`_virtual_${VIRTUAL_RUNTIME_RESOLVED}`)
	) {
		return true;
	}

	const base = clean.split("/").pop() ?? clean;
	const decodedBase = decodeUriComponentSafe(base);
	const isRuntimeName =
		decodedBase === VIRTUAL_RUNTIME_RESOLVED ||
		base === encoded ||
		base === "tailwind-atomic-runtime";
	if (!isRuntimeName) return false;

	return clean.includes("_virtual_") || clean.includes("__virtual__");
}

function isAtomicRuntimeModule(id: string) {
	const clean = posixId(id);
	if (!clean) return false;
	if (clean === VIRTUAL_RUNTIME_IMPORT || clean === VIRTUAL_RUNTIME_RESOLVED) {
		return true;
	}
	if (isVirtualRuntimeLoadId(id)) return true;
	if (clean.includes("tailwind-atomic-runtime")) return true;
	return /(?:^|\/)atomic-runtime\.(mjs|cjs|js|mts|cts|ts)$/.test(clean);
}

function packageDeclaresTwMerge(root: string) {
	try {
		const pkgPath = path.join(root, "package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
			name?: string;
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		if (pkg.name === "tailwindcss-atomic") return false;
		return Boolean(
			pkg.dependencies?.["tailwind-merge"] ||
			pkg.devDependencies?.["tailwind-merge"],
		);
	} catch {
		return false;
	}
}

function projectHasTwMerge() {
	const roots = [
		...ATOMIC_RUNTIME.projectRoots,
		process.env["TAILWIND_ATOMIC_PROJECT_ROOT"],
		process.cwd(),
	].filter((dir): dir is string => Boolean(dir));

	for (const root of roots) {
		if (!packageDeclaresTwMerge(root)) continue;
		try {
			createRequire(path.join(root, "package.json")).resolve("tailwind-merge");
			return true;
		} catch {
			continue;
		}
	}
	return false;
}

function toPlainMap(classMap: Record<string, string>) {
	const plain: Record<string, string> = {};
	for (const [key, value] of Object.entries(classMap)) {
		if (typeof value === "string" && value) plain[key] = value;
	}
	return plain;
}

function generateRuntimeModule() {
	const classMap = toPlainMap(ATOMIC_RUNTIME.classMap);
	const hasTwMerge = projectHasTwMerge();
	const importLine = hasTwMerge
		? `import { twMerge } from "tailwind-merge";`
		: `const twMerge = (value) => value;`;

	return `${importLine}

const CLASS_MAP = ${JSON.stringify(classMap)};
const REVERSE_MAP = {};
for (const original in CLASS_MAP) {
	for (const hash of String(CLASS_MAP[original]).split(/\\s+/)) {
		if (hash) REVERSE_MAP[hash] = original;
	}
}

function splitTokens(value) {
	return value.split(/[\\s"']+/).filter(Boolean);
}

function isMappedToken(cls) {
	return Boolean(CLASS_MAP[cls] || REVERSE_MAP[cls]);
}

function rewrite(value) {
	if (value == null || value === false) return value;
	if (typeof value !== "string") return value;
	const leading = value.match(/^\\s*/)?.[0] ?? "";
	const trailing = value.match(/\\s*$/)?.[0] ?? "";
	const mid = value.slice(leading.length, value.length - trailing.length);
	if (!mid) return value;
	const rewritten = splitTokens(mid)
		.map((cls) => CLASS_MAP[cls] || cls)
		.join(" ");
	return leading + rewritten + trailing;
}

function unhash(value) {
	return splitTokens(value)
		.map((cls) => REVERSE_MAP[cls] || cls)
		.join(" ");
}

function atomicReconcile(value) {
	if (typeof value !== "string") return value;
	const leading = value.match(/^\\s*/)?.[0] ?? "";
	const trailing = value.match(/\\s*$/)?.[0] ?? "";
	const mid = value.slice(leading.length, value.length - trailing.length);
	if (!mid) return value;
	const tokens = splitTokens(mid);
	const known = [];
	const slots = [];
	let placedKnown = false;
	for (const cls of tokens) {
		if (isMappedToken(cls)) {
			known.push(cls);
			if (!placedKnown) {
				slots.push(null);
				placedKnown = true;
			}
		} else {
			slots.push(cls);
		}
	}
	const merged = known.length
		? rewrite(twMerge(unhash(known.join(" "))))
		: "";
	const parts = slots.map((slot) => (slot == null ? merged : slot)).filter(Boolean);
	return leading + parts.join(" ") + trailing;
}

export { atomicReconcile, rewrite as atomicClassName };
`;
}

export {
	VIRTUAL_RUNTIME_IMPORT,
	VIRTUAL_RUNTIME_RESOLVED,
	RUNTIME_FN,
	generateRuntimeModule,
	isAtomicRuntimeModule,
	isVirtualRuntimeLoadId,
	projectHasTwMerge,
};
