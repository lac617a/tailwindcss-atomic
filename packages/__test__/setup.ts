import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {ATOMIC_RUNTIME, DEFAULT_TARGET_FUNCTIONS} from "../shared/constants";
import {
	defaultProcessTailwindCss,
	processTailwindCss,
	wasmMock,
} from "./helpers";
import {clearLinkedPackageCache} from "../shared/js";

const packagesRoot = path.resolve(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
);
const loaderStubPath = path.join(packagesRoot, "loader.cjs");

vi.mock("../core/wasm", () => ({
	process_tailwind_css: (css: string) => processTailwindCss(css),
}));

if (!fs.existsSync(loaderStubPath)) {
	fs.writeFileSync(
		loaderStubPath,
		`"use strict";\nmodule.exports = function tailwindAtomicWebpackLoader(source) {\n\treturn source;\n};\n`,
	);
}

beforeEach(() => {
	wasmMock.impl = defaultProcessTailwindCss;
	ATOMIC_RUNTIME.classMap = Object.create(null);
	ATOMIC_RUNTIME.classMap["__skip_warmup"] = "_skip";
	ATOMIC_RUNTIME.viteServer = null;
	ATOMIC_RUNTIME.projectRoots = [];
	ATOMIC_RUNTIME.webpackWatchings.clear();
	ATOMIC_RUNTIME.targetFunctions = new Set(DEFAULT_TARGET_FUNCTIONS);
	ATOMIC_RUNTIME.transpilePackages = new Set();
	ATOMIC_RUNTIME.ignoreCss = [];
	delete process.env["TAILWIND_ATOMIC_PROJECT_ROOT"];
	clearLinkedPackageCache();
	if (!fs.existsSync(loaderStubPath)) {
		fs.writeFileSync(
			loaderStubPath,
			`"use strict";\nmodule.exports = function tailwindAtomicWebpackLoader(source) {\n\treturn source;\n};\n`,
		);
	}
});
