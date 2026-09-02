import {createRequire} from "node:module";
import path from "node:path";

import {ATOMIC_RUNTIME} from "./constants";

const VIRTUAL_RUNTIME_IMPORT = "virtual:tailwind-atomic/runtime";
const VIRTUAL_RUNTIME_RESOLVED = "\0tailwind-atomic-runtime";
const RUNTIME_FN = "_twAtomicReconcile";

const RECONCILE_CALLEES = new Set(["cn", "twMerge", "clsxMerge"]);

function projectHasTwMerge() {
	const roots = [
		...ATOMIC_RUNTIME.projectRoots,
		process.env["TAILWIND_ATOMIC_PROJECT_ROOT"],
		process.cwd(),
	].filter((dir): dir is string => Boolean(dir));

	for (const root of roots) {
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

function rewrite(value) {
	if (value == null || value === false) return value;
	if (typeof value !== "string") return value;
	const leading = value.match(/^\\s*/)?.[0] ?? "";
	const trailing = value.match(/\\s*$/)?.[0] ?? "";
	const mid = value.slice(leading.length, value.length - trailing.length);
	if (!mid) return value;
	const rewritten = mid
		.split(/[\\s"']+/)
		.filter(Boolean)
		.map((cls) => CLASS_MAP[cls] || cls)
		.join(" ");
	return leading + rewritten + trailing;
}

function unhash(value) {
	return value
		.split(/[\\s"']+/)
		.filter(Boolean)
		.map((cls) => REVERSE_MAP[cls] || cls)
		.join(" ");
}

function atomicReconcile(value) {
	if (typeof value !== "string") return value;
	return rewrite(twMerge(unhash(value)));
}

export { atomicReconcile, rewrite as atomicClassName };
`;
}

export {
	VIRTUAL_RUNTIME_IMPORT,
	VIRTUAL_RUNTIME_RESOLVED,
	RUNTIME_FN,
	RECONCILE_CALLEES,
	generateRuntimeModule,
	projectHasTwMerge,
};
