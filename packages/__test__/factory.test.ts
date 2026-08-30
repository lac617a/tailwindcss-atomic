import factory, {transformAtomicSource} from "../core/factory";
import {ATOMIC_RUNTIME} from "../shared/constants";

type Plugin = ReturnType<typeof factory>;

function createPlugin(options?: Parameters<typeof factory>[0]) {
	return factory(options ?? {}) as Plugin & {
		transformInclude: (id: string) => boolean;
		transform: (code: string, id: string) => Promise<{code: string} | null>;
		buildStart: () => Promise<void>;
		vite: {
			configResolved: (config: {root?: string}) => void;
			configureServer: (server: unknown) => void;
		};
		rollup: {
			generateBundle: (
				options: unknown,
				bundle: Record<string, unknown>,
			) => void;
		};
		webpack: (compiler: unknown) => void;
	};
}

describe("transformAtomicSource", () => {
	beforeEach(() => {
		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";
	});

	it("skips empty input, node_modules and non-JS", async () => {
		expect(await transformAtomicSource("", "app.tsx")).toEqual({
			code: null,
			map: null,
		});
		expect(await transformAtomicSource("cn('flex')", "")).toEqual({
			code: null,
			map: null,
		});
		expect(
			await transformAtomicSource("cn('flex')", "node_modules/lib.js"),
		).toEqual({code: null, map: null});
		expect(await transformAtomicSource("cn('flex')", "app/.next/file.js")).toEqual(
			{code: null, map: null},
		);
		expect(await transformAtomicSource("body{}", "app.css")).toEqual({
			code: null,
			map: null,
		});
	});

	it("rewrites JS sources", async () => {
		const result = await transformAtomicSource(
			`export const n = <div className="flex" />;`,
			"src\\app.tsx",
		);
		expect(result.code).toContain("_aaaaaa");
	});
});

describe("factory plugin", () => {
	it("registers the plugin name and post enforce", () => {
		const plugin = createPlugin();
		expect(plugin.name).toBe("tailwind-atomic-plugin");
		expect(plugin.enforce).toBe("post");
	});

	it("preloads a class map from tailwindCss", () => {
		createPlugin({tailwindCss: ".flex { display: flex }"});
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
	});

	it("honors custom target functions", () => {
		createPlugin({targetFunctions: new Set(["tw"])});
		expect(ATOMIC_RUNTIME.targetFunctions).toEqual(new Set(["tw"]));
	});

	it("filters transform ids", () => {
		const plugin = createPlugin();
		expect(plugin.transformInclude("")).toBe(false);
		expect(plugin.transformInclude("?")).toBe(false);
		expect(plugin.transformInclude("node_modules/pkg.js")).toBe(false);
		expect(plugin.transformInclude("app/.next/file.js")).toBe(false);
		expect(plugin.transformInclude("src/app.tsx")).toBe(true);
		expect(plugin.transformInclude("src/index.css")).toBe(true);
		expect(plugin.transformInclude("src/Button.module.css")).toBe(false);
	});

	it("skips Vite-injected CSS and atomicizes real stylesheets", async () => {
		const plugin = createPlugin();
		expect(
			await plugin.transform("import.meta.hot; .flex{}", "app.css"),
		).toBeNull();
		expect(
			await plugin.transform("function updateStyle() {}", "app.css"),
		).toBeNull();
		expect(await plugin.transform("export const x = 1", "app.css")).toBeNull();

		const atomic = await plugin.transform(".flex { display: flex }", "app.css");
		expect(atomic?.code).toContain("/*! tailwind-atomic */");

		expect(await plugin.transform(":root{color:red}", "app.css")).toBeNull();
	});

	it("transforms JS when the class map has entries", async () => {
		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";
		const plugin = createPlugin();
		const result = await plugin.transform(
			`export const n = <div className="flex" />;`,
			"app.tsx",
		);
		expect(result?.code).toContain("_aaaaaa");
		expect(await plugin.transform("const x = 1;", "app.tsx")).toBeNull();
		expect(await plugin.transform("const x = 1;", "readme.md")).toBeNull();
	});

	it("wires Vite root and server", async () => {
		const plugin = createPlugin();
		await plugin.buildStart();
		plugin.vite.configResolved({root: "/tmp/project"});
		expect(ATOMIC_RUNTIME.projectRoots[0]).toBe("/tmp/project");
		const server = {moduleGraph: {idToModuleMap: new Map(), invalidateModule() {}}};
		plugin.vite.configureServer(server);
		expect(ATOMIC_RUNTIME.viteServer).toBe(server);
	});

	it("rewrites Rollup CSS assets and JS chunks", () => {
		const plugin = createPlugin();
		const bundle = {
			"main.css": {
				type: "asset",
				fileName: "main.css",
				source: ".flex { display: flex }",
			},
			"raw.css": {
				type: "asset",
				fileName: "raw.css",
				source: new Uint8Array(Buffer.from(":root { color: red }")),
			},
			"main.js": {
				type: "chunk",
				fileName: "main.js",
				code: `cn("flex")`,
			},
		};

		plugin.rollup.generateBundle({}, bundle);
		expect(String(bundle["main.css"]?.source)).toContain("/*! tailwind-atomic */");
		expect(bundle["main.js"]?.code).toContain(ATOMIC_RUNTIME.classMap["flex"]);
	});
});

describe("factory webpack hook", () => {
	it("injects the loader and rewrites assets", async () => {
		const plugin = createPlugin();
		const loaders: {loader: string}[] = [];
		const updated: Record<string, string> = {};
		let processAssets:
			| ((assets: Record<string, {source: () => string}>) => Promise<void>)
			| undefined;
		let loaderTap: ((ctx: unknown, module: unknown) => void) | undefined;
		let beforeCompile: (() => Promise<void>) | undefined;

		class RawSource {
			constructor(public source: string) {}
		}

		const jsModule = {
			resource: "/tmp/app/src/App.tsx",
			loaders,
		};
		const skipped = {
			resource: "/tmp/app/node_modules/pkg.js",
			loaders: [] as {loader: string}[],
		};
		const nextInternal = {
			resource: `/tmp/app${"\\"}`.concat(".next\\file.js"),
			loaders: [] as {loader: string}[],
		};

		const compiler = {
			context: "/tmp/app",
			webpack: {
				Compilation: {PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE: 400},
				sources: {RawSource},
				NormalModule: {
					getCompilationHooks() {
						return {
							loader: {
								tap(_name: string, fn: (ctx: unknown, module: unknown) => void) {
									loaderTap = fn;
								},
							},
						};
					},
				},
			},
			hooks: {
				beforeCompile: {
					tapPromise(_name: string, fn: () => Promise<void>) {
						beforeCompile = fn;
					},
				},
				compilation: {
					tap(_name: string, fn: (compilation: unknown) => void) {
						fn({
							hooks: {
								processAssets: {
									tapPromise(
										_opts: unknown,
										cb: (assets: Record<string, {source: () => string}>) => Promise<void>,
									) {
										processAssets = cb;
									},
								},
							},
							updateAsset(fileName: string, source: RawSource) {
								updated[fileName] = source.source;
							},
						});
					},
				},
			},
		};

		plugin.webpack(compiler);
		expect(process.env["TAILWIND_ATOMIC_PROJECT_ROOT"]).toBe("/tmp/app");
		expect(ATOMIC_RUNTIME.projectRoots).toContain("/tmp/app");

		await beforeCompile?.();
		loaderTap?.({}, jsModule);
		expect(loaders[0]?.loader.replace(/\\/g, "/")).toMatch(/loader\.cjs$/);

		loaderTap?.({}, jsModule);
		expect(loaders).toHaveLength(1);

		loaderTap?.({}, skipped);
		loaderTap?.({}, nextInternal);
		loaderTap?.({}, {resource: "", loaders: []});
		expect(skipped.loaders).toHaveLength(0);

		await processAssets?.({
			"main.css": {source: () => ".flex { display: flex }"},
			"main.js": {source: () => `cn("flex")`},
			"plain.txt": {source: () => "hello"},
			"buffer.js": {
				source: () => Buffer.from(`cn("flex")`).toString(),
			},
		});
		expect(updated["main.css"]).toContain("/*! tailwind-atomic */");
		expect(updated["main.js"]).toContain(ATOMIC_RUNTIME.classMap["flex"]);
	});
});
