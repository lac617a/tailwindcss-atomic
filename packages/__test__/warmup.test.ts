import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {ATOMIC_RUNTIME} from "../shared/constants";

const noopPlugin = `"use strict";
function plugin() {
	return {postcssPlugin: "fake-plugin", Once() {}};
}
plugin.postcss = true;
module.exports = plugin;
`;

const defaultExportPlugin = `"use strict";
function plugin() {
	return {postcssPlugin: "fake-plugin", Once() {}};
}
plugin.postcss = true;
exports.default = plugin;
`;

const throwingPlugin = `"use strict";
function plugin() {
	return {
		postcssPlugin: "boom",
		Once() {
			throw new Error("warmup boom");
		},
	};
}
plugin.postcss = true;
module.exports = plugin;
`;

const fixtures: string[] = [];

function writeModule(root: string, id: string, source: string) {
	const dir = path.join(root, "node_modules", ...id.split("/"));
	fs.mkdirSync(dir, {recursive: true});
	fs.writeFileSync(
		path.join(dir, "package.json"),
		JSON.stringify({name: id, main: "index.js"}),
	);
	fs.writeFileSync(path.join(dir, "index.js"), source);
}

function makeApp(options: {
	modules?: Record<string, string>;
	skipPackageJson?: boolean;
} = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-warmup-"));
	fixtures.push(root);
	fs.mkdirSync(path.join(root, "app"), {recursive: true});
	fs.writeFileSync(
		path.join(root, "app/globals.css"),
		".flex { display: flex }",
	);
	if (!options.skipPackageJson) {
		fs.writeFileSync(
			path.join(root, "package.json"),
			JSON.stringify({name: "fixture-app"}),
		);
	}
	for (const [id, source] of Object.entries(options.modules ?? {})) {
		writeModule(root, id, source);
	}
	return root;
}

async function getWarmup() {
	vi.resetModules();
	ATOMIC_RUNTIME.classMap = Object.create(null);
	const css = await vi.importActual<typeof import("../shared/css")>(
		"../shared/css",
	);
	return css.warmupClassMapFromCss;
}

function pointAt(root: string) {
	process.env["TAILWIND_ATOMIC_PROJECT_ROOT"] = root;
	process.env["INIT_CWD"] = root;
	ATOMIC_RUNTIME.projectRoots = [root];
}

afterEach(() => {
	for (const dir of fixtures) {
		fs.rmSync(dir, {recursive: true, force: true});
	}
	fixtures.length = 0;
	delete process.env["INIT_CWD"];
});

describe("warmupClassMapFromCss", () => {
	it("returns immediately when the class map is already warm", async () => {
		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";
		const warmup = await getWarmup();
		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";
		await warmup();
		expect(ATOMIC_RUNTIME.classMap["flex"]).toBe("_aaaaaa");
	});

	it("reuses an in-flight warmup promise", async () => {
		const root = makeApp({modules: {tailwindcss: noopPlugin}});
		pointAt(root);
		const warmup = await getWarmup();
		const first = warmup();
		const second = warmup();
		await Promise.all([first, second]);
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
	});

	it("loads an app PostCSS config when postcss-load-config succeeds", async () => {
		const root = makeApp({
			modules: {
				"postcss-load-config": `"use strict";
const plugin = () => ({postcssPlugin: "from-config", Once() {}});
plugin.postcss = true;
module.exports = async () => ({plugins: [plugin]});
`,
			},
		});
		pointAt(root);
		const warmup = await getWarmup();
		await warmup();
		expect(ATOMIC_RUNTIME.classMap).toEqual({});
	});

	it("falls through when postcss-load-config returns no plugins", async () => {
		const root = makeApp({
			modules: {
				"postcss-load-config": `"use strict";
module.exports = async () => ({plugins: []});
`,
				"@tailwindcss/postcss": defaultExportPlugin,
				autoprefixer: noopPlugin,
			},
		});
		pointAt(root);
		const warmup = await getWarmup();
		await warmup();
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
	});

	it("uses @tailwindcss/postcss without a default export", async () => {
		const root = makeApp({
			modules: {"@tailwindcss/postcss": noopPlugin},
		});
		pointAt(root);
		const warmup = await getWarmup();
		await warmup();
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
	});

	it("falls back to tailwindcss when the v4 plugin is missing", async () => {
		const root = makeApp({modules: {tailwindcss: noopPlugin}});
		pointAt(root);
		const warmup = await getWarmup();
		await warmup();
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
	});

	it("returns when neither Tailwind package can be required", async () => {
		const root = makeApp();
		pointAt(root);
		const warmup = await getWarmup();
		await expect(warmup()).resolves.toBeUndefined();
	});

	it("swallows warmup failures and warns", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const root = makeApp({
			modules: {"@tailwindcss/postcss": throwingPlugin},
		});
		pointAt(root);
		const warmup = await getWarmup();
		await warmup();
		expect(warn).toHaveBeenCalledWith(
			"[tailwind-atomic] warmup failed:",
			expect.any(Error),
		);
		warn.mockRestore();
	});

	it("uses the CSS folder as package dir when no package.json exists", async () => {
		const root = makeApp({skipPackageJson: true});
		pointAt(root);
		const warmup = await getWarmup();
		await expect(warmup()).resolves.toBeUndefined();
	});
});
