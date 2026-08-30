import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {ATOMIC_RUNTIME, DEFAULT_TARGET_FUNCTIONS} from "../shared/constants";

const packagesRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const loaderStubPath = path.join(packagesRoot, "loader.cjs");

const {process_tailwind_css} = vi.hoisted(() => {
	function process_tailwind_css(css: string) {
		const class_map: Record<string, string> = Object.create(null);
		const css_rules: string[] = [];
		const ruleRe = /([^{]+)\{([^}]*)\}/g;

		for (const match of css.matchAll(ruleRe)) {
			const selector = match[1]?.trim() ?? "";
			const decls = match[2]?.trim() ?? "";
			if (!selector || !decls) continue;

			let nextSelector = selector;
			for (const classMatch of selector.matchAll(/\.((?:\\.|[^\s.:#[\]>+~,])+)/g)) {
				const raw = classMatch[1];
				if (!raw) continue;
				const key = raw.replace(/\\/g, "");
				if (!class_map[key]) {
					let hash = 2166136261;
					for (let i = 0; i < key.length; i++) {
						hash ^= key.charCodeAt(i);
						hash = Math.imul(hash, 16777619);
					}
					class_map[key] = `_${(hash >>> 0).toString(16).padStart(8, "0").slice(0, 6)}`;
				}
				const hashed = class_map[key];
				if (hashed) {
					nextSelector = nextSelector.replace(classMatch[0], `.${hashed}`);
				}
			}

			css_rules.push(`${nextSelector} { ${decls} }`);
		}

		return {class_map, css_rules};
	}

	return {process_tailwind_css};
});

vi.mock("../core/wasm", () => ({process_tailwind_css}));

vi.mock("../shared/css", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../shared/css")>();
	return {
		...actual,
		warmupClassMapFromCss: vi.fn(async () => undefined),
	};
});

if (!fs.existsSync(loaderStubPath)) {
	fs.writeFileSync(
		loaderStubPath,
		`"use strict";\nmodule.exports = function tailwindAtomicWebpackLoader(source) {\n\treturn source;\n};\n`,
	);
}

beforeEach(() => {
	ATOMIC_RUNTIME.classMap = Object.create(null);
	ATOMIC_RUNTIME.viteServer = null;
	ATOMIC_RUNTIME.projectRoots = [];
	ATOMIC_RUNTIME.targetFunctions = new Set(DEFAULT_TARGET_FUNCTIONS);
	delete process.env["TAILWIND_ATOMIC_PROJECT_ROOT"];
});
