import type {Configuration} from "webpack";

import {withTailwindAtomic} from "../next";
import {ATOMIC_RUNTIME} from "../shared/constants";

const loaderRule = {
	loaders: [expect.stringMatching(/loader\.cjs$/)],
	as: "*",
};

describe("withTailwindAtomic", () => {
	it("injects turbopack loader rules for app and workspace files", () => {
		const config = withTailwindAtomic();
		const rules = config.turbopack?.rules ?? {};
		expect(rules["*.tsx"]).toEqual({
			foreign: loaderRule,
			default: loaderRule,
		});
		expect(rules["*.ts"]).toBeDefined();
		expect(rules["*.jsx"]).toBeDefined();
		expect(rules["*.js"]).toEqual({
			foreign: loaderRule,
			default: loaderRule,
		});
		expect(rules["*.mjs"]).toBeDefined();
		expect(config.turbopack?.root).toBeTruthy();
		expect(config.outputFileTracingRoot).toBe(config.turbopack?.root);
	});

	it("keeps user turbopack rules and calls the original webpack hook", () => {
		const webpack = vi.fn((cfg: Configuration) => cfg);
		const config = withTailwindAtomic({
			turbopack: {
				root: "/tmp/app",
				rules: {
					"*.svg": {loaders: ["svgo"], as: "*.js"},
				},
			},
			webpack,
		});

		expect(config.turbopack?.root).toBe("/tmp/app");
		expect(config.turbopack?.rules?.["*.svg"]).toEqual({
			loaders: ["svgo"],
			as: "*.js",
		});

		const webpackConfig: Configuration = {plugins: [], module: {rules: []}};
		const result = config.webpack?.(webpackConfig, {dev: true});
		expect(webpack).toHaveBeenCalledWith(webpackConfig, {dev: true});
		expect(result?.plugins?.length).toBeGreaterThan(0);
		expect(result?.module?.rules?.[0]).toMatchObject({
			enforce: "pre",
			use: [{loader: expect.stringMatching(/loader\.cjs$/)}],
		});
		const loaderRule = result?.module?.rules?.[0] as {
			exclude?: (resource: string) => boolean;
		};
		expect(typeof loaderRule.exclude).toBe("function");
		expect(loaderRule.exclude?.("src/app.tsx")).toBe(false);
		expect(loaderRule.exclude?.("node_modules/react/index.js")).toBe(true);
		expect(
			loaderRule.exclude?.(
				"node_modules/tailwindcss-atomic/dist/atomic-runtime.mjs",
			),
		).toBe(false);
		if (process.platform === "win32") {
			expect(result?.cache).toEqual({type: "memory"});
		}
		expect(process.env["TAILWIND_ATOMIC_PROJECT_ROOT"]).toBe(process.cwd());
	});

	it("accepts Next.js NextConfig when webpack is null", () => {
		type NextJsWebpackConfig = (
			config: Configuration,
			context: {
				dir: string;
				dev: boolean;
				isServer: boolean;
				buildId: string;
				config: object;
				defaultLoaders: {babel: unknown};
				totalPages: number;
				webpack: unknown;
			},
		) => Configuration | null;

		type NextJsNextConfig = {
			reactCompiler?: boolean;
			webpack?: NextJsWebpackConfig | null;
			images?: {remotePatterns?: {hostname: string}[]};
			headers?: () => Promise<
				{source: string; headers: {key: string; value: string}[]}[]
			>;
			turbopack?: {
				root?: string;
				rules?: Record<string, {loaders?: string[]; as?: string}>;
				resolveAlias?: Record<string, string | string[]>;
				resolveExtensions?: string[];
			};
		};

		const nextConfig: NextJsNextConfig = {
			reactCompiler: true,
			webpack: null,
			headers: async () => [],
			turbopack: {
				root: "/tmp/app",
				resolveExtensions: [".tsx", ".ts"],
			},
		};
		const wrapped = withTailwindAtomic(nextConfig);
		expect(wrapped.reactCompiler).toBe(true);
		expect(wrapped.turbopack.root).toBe("/tmp/app");
		expect(typeof wrapped.webpack).toBe("function");

		const webpackConfig: Configuration = {plugins: [], module: {rules: []}};
		expect(wrapped.webpack(webpackConfig, {dev: false})).toBeDefined();
	});

	it("falls back to the webpack config when the user hook returns null", () => {
		const webpack = vi.fn(() => null);
		const config = withTailwindAtomic({webpack});
		const webpackConfig: Configuration = {plugins: [], module: {rules: []}};
		const result = config.webpack(webpackConfig, {dev: false});
		expect(webpack).toHaveBeenCalledWith(webpackConfig, {dev: false});
		expect(result?.plugins?.length).toBeGreaterThan(0);
	});

	it("allows transpilePackages from Next config through the webpack exclude", () => {
		const config = withTailwindAtomic({
			transpilePackages: ["ui-latamwin"],
		});
		const webpackConfig: Configuration = {plugins: [], module: {rules: []}};
		const result = config.webpack?.(webpackConfig, {dev: false});
		const loaderRule = result?.module?.rules?.[0] as {
			exclude?: (resource: string) => boolean;
		};
		expect(
			loaderRule.exclude?.("node_modules/ui-latamwin/dist/Button.js"),
		).toBe(false);
		expect(ATOMIC_RUNTIME.transpilePackages.has("ui-latamwin")).toBe(true);
	});

	it("records cssEntries and keeps an explicit turbopack root", () => {
		const config = withTailwindAtomic(
			{turbopack: {root: "/tmp/app"}},
			{cssEntries: ["scss/styles.scss"]},
		);
		expect(ATOMIC_RUNTIME.cssEntries).toContain("scss/styles.scss");
		expect(config.turbopack?.root).toBe("/tmp/app");
		expect(config.outputFileTracingRoot).toBe("/tmp/app");
	});

	it("falls back to dist/loader.cjs when the source shim is missing", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const {fileURLToPath} = await import("node:url");
		const packagesRoot = path.resolve(
			fileURLToPath(new URL(".", import.meta.url)),
			"..",
		);
		const sourceLoader = path.join(packagesRoot, "loader.cjs");
		const distDir = path.join(packagesRoot, "dist");
		const distLoader = path.join(distDir, "loader.cjs");
		const hadSource = fs.existsSync(sourceLoader);
		if (hadSource) fs.unlinkSync(sourceLoader);
		fs.mkdirSync(distDir, {recursive: true});
		if (!fs.existsSync(distLoader)) {
			fs.writeFileSync(
				distLoader,
				`"use strict";\nmodule.exports = function () {};\n`,
			);
		}

		try {
			vi.resetModules();
			const {withTailwindAtomic: fresh} = await import("../next");
			const config = fresh();
			const tsx = config.turbopack?.rules?.["*.tsx"] as {
				default?: {loaders?: string[]};
			};
			expect(tsx.default?.loaders?.[0]?.replace(/\\/g, "/")).toMatch(
				/loader\.cjs$/,
			);
		} finally {
			fs.writeFileSync(
				sourceLoader,
				`"use strict";\nmodule.exports = function tailwindAtomicWebpackLoader(source) {\n\treturn source;\n};\n`,
			);
		}
	});
});
