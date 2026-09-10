import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {ATOMIC_RUNTIME, DEFAULT_TARGET_FUNCTIONS, clearProjectRootEnv} from "../src/engine/constants";
import {
	defaultProcessTailwindCss,
	processTailwindCss,
	wasmMock,
} from "./helpers";
import {clearLinkedPackageCache} from "../src/engine/js";
import {resetAtomicReport} from "../src/engine/report";

const packagesRoot = path.resolve(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
);
const loaderStubPath = path.join(packagesRoot, "loader.cjs");
const wasmArtifact = path.join(
	packagesRoot,
	"pkg",
	"tailwindcss_atomic_wasm.js",
);

if (!fs.existsSync(wasmArtifact)) {
	throw new Error(
		"Missing packages/tailwindcss-atomic/pkg. Run `pnpm build:wasm` before Vitest.",
	);
}

vi.mock("../src/engine/wasm", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/engine/wasm.js")>();
	return {
		...actual,
		process_tailwind_css: (css: string) => processTailwindCss(css),
	};
});

if (!fs.existsSync(loaderStubPath)) {
	fs.writeFileSync(
		loaderStubPath,
		`"use strict";\nmodule.exports = function tailwindcssAtomicWebpackLoader(source) {\n\treturn source;\n};\n`,
	);
}

beforeEach(() => {
	wasmMock.impl = defaultProcessTailwindCss;
	ATOMIC_RUNTIME.classMap = Object.create(null);
	ATOMIC_RUNTIME.classMap["__skip_warmup"] = "_skip";
	ATOMIC_RUNTIME.hashReverse = Object.create(null);
	ATOMIC_RUNTIME.viteServer = null;
	ATOMIC_RUNTIME.projectRoots = [];
	ATOMIC_RUNTIME.webpackWatchings.clear();
	ATOMIC_RUNTIME.targetFunctions = new Set(DEFAULT_TARGET_FUNCTIONS);
	ATOMIC_RUNTIME.transpilePackages = new Set();
	ATOMIC_RUNTIME.ignoreCss = [];
	ATOMIC_RUNTIME.preserveClasses = [];
	ATOMIC_RUNTIME.preserveFunctions = new Set(["twIgnore"]);
	ATOMIC_RUNTIME.classMapFile = false;
	ATOMIC_RUNTIME.cssEntries = [];
	clearProjectRootEnv();
	clearLinkedPackageCache();
	resetAtomicReport();
	delete process.env.TAILWINDCSS_ATOMIC_REPORT;
	delete process.env.TAILWINDCSS_ATOMIC_BUNDLER;
	if (!fs.existsSync(loaderStubPath)) {
		fs.writeFileSync(
			loaderStubPath,
			`"use strict";\nmodule.exports = function tailwindcssAtomicWebpackLoader(source) {\n\treturn source;\n};\n`,
		);
	}
});
