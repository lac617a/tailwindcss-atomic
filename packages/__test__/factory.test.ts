import factory, {transformAtomicSource} from "../core/factory";
import {ATOMIC_RUNTIME} from "../shared/constants";
import {applyAtomicCss} from "../shared/css";
import {invalidateJsModules} from "../shared/js";

type Plugin = ReturnType<typeof factory>;

function createPlugin(options?: Parameters<typeof factory>[0]) {
	return factory(options ?? {}) as Plugin & {
		transformInclude: (id: string) => boolean;
		transform: (code: string, id: string) => Promise<{code: string} | null>;
		buildStart: () => Promise<void>;
		vite: {
			configResolved: (config: {root?: string}) => void;
			configureServer: (server: unknown) => void;
			transformIndexHtml: (html: string) => string;
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

	it("emits the generated runtime for atomic-runtime modules", async () => {
		const result = await transformAtomicSource(
			"export function atomicReconcile(value) { return value; }",
			"packages/dist/atomic-runtime.mjs",
		);
		expect(result.code).toContain("atomicReconcile");
		expect(result.code).toContain("_aaaaaa");
		expect(result.code).toContain("CLASS_MAP");
	});

	it("rewrites JS sources", async () => {
		const result = await transformAtomicSource(
			`export const n = <div className="flex" />;`,
			"src\\app.tsx",
		);
		expect(result.code).toContain("_aaaaaa");
	});

	it("rewrites transpilePackages under node_modules", async () => {
		ATOMIC_RUNTIME.transpilePackages.add("ui-latamwin");
		const result = await transformAtomicSource(
			`export const n = <div className="flex" />;`,
			"node_modules/ui-latamwin/dist/Button.js",
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

	it("records cssEntries for warmup", () => {
		createPlugin({cssEntries: ["scss/styles.scss"]});
		expect(ATOMIC_RUNTIME.cssEntries).toContain("scss/styles.scss");
	});

	it("filters transform ids", () => {
		const plugin = createPlugin();
		expect(plugin.transformInclude("")).toBe(false);
		expect(plugin.transformInclude("?")).toBe(false);
		expect(plugin.transformInclude("node_modules/pkg.js")).toBe(false);
		expect(plugin.transformInclude("app/.next/file.js")).toBe(false);
		expect(plugin.transformInclude("src/app.tsx")).toBe(true);
		expect(plugin.transformInclude("src/index.css")).toBe(true);
		expect(plugin.transformInclude("index.html")).toBe(true);
		expect(plugin.transformInclude("src/pages/index.astro")).toBe(true);
		expect(plugin.transformInclude("src/Button.module.css")).toBe(false);
		expect(
			plugin.transformInclude("node_modules/slick-carousel/slick/slick.css"),
		).toBe(false);
		expect(
			plugin.transformInclude(
				"D:\\repo\\node_modules\\slick-carousel\\slick\\slick.css",
			),
		).toBe(false);

		ATOMIC_RUNTIME.transpilePackages.add("ui-latamwin");
		expect(
			plugin.transformInclude("node_modules/ui-latamwin/dist/Button.js"),
		).toBe(true);
		expect(plugin.transformInclude("node_modules/ui-latamwin/styles.css")).toBe(
			false,
		);
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

	it("does not transform slick-carousel CSS under node_modules", async () => {
		const plugin = createPlugin();
		const slick = ".slick-slide { display: none; float: left; }";
		expect(
			await plugin.transform(
				slick,
				"node_modules/slick-carousel/slick/slick.css",
			),
		).toBeNull();
		expect(
			await plugin.transform(
				slick,
				"D:\\repo\\node_modules\\slick-carousel\\slick\\slick.css",
			),
		).toBeNull();
		expect(ATOMIC_RUNTIME.classMap["slick-slide"]).toBeUndefined();
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
		const html = await plugin.transform('<div class="flex"></div>', "index.html");
		expect(html?.code).toContain("_aaaaaa");
		const astro = await plugin.transform(
			`export default () => renderTemplate\`<div class="flex"></div>\`;`,
			"src/pages/index.astro",
		);
		expect(astro?.code).toContain("_aaaaaa");
	});

	it("wires Vite root and server", async () => {
		const plugin = createPlugin();
		await plugin.buildStart();
		plugin.vite.configResolved({root: "/tmp/project"});
		expect(ATOMIC_RUNTIME.projectRoots[0]).toBe("/tmp/project");
		plugin.vite.configResolved({});
		expect(ATOMIC_RUNTIME.projectRoots[0]).toBe("/tmp/project");
		const server = {moduleGraph: {idToModuleMap: new Map(), invalidateModule() {}}};
		plugin.vite.configureServer(server);
		expect(ATOMIC_RUNTIME.viteServer).toBe(server);
		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";
		expect(plugin.vite.transformIndexHtml('<main class="flex"></main>')).toBe(
			'<main class="_aaaaaa"></main>',
		);
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
			"index.html": {
				type: "asset",
				fileName: "index.html",
				source: '<div class="flex"></div>',
			},
		};

		plugin.rollup.generateBundle({}, bundle);
		expect(String(bundle["main.css"]?.source)).toContain("/*! tailwind-atomic */");
		expect(bundle["main.js"]?.code).toContain(ATOMIC_RUNTIME.classMap["flex"]);
		expect(String(bundle["index.html"]?.source)).toContain(
			ATOMIC_RUNTIME.classMap["flex"],
		);
	});

	it("leaves Rollup assets unchanged when nothing atomicizes", () => {
		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";
		const plugin = createPlugin();
		const bundle = {
			"main.css": {
				type: "asset",
				fileName: "main.css",
				source: ":root { color: red }",
			},
			"main.js": {
				type: "chunk",
				fileName: "main.js",
				code: `other("flex")`,
			},
			"note.txt": {
				type: "asset",
				fileName: "note.txt",
				source: "hello",
			},
		};
		plugin.rollup.generateBundle({}, bundle);
		expect(bundle["main.css"]?.source).toBe(":root { color: red }");
		expect(bundle["main.js"]?.code).toBe(`other("flex")`);
	});

	it("invalidates JS modules after CSS is atomicized", async () => {
		const invalidateModule = vi.fn();
		ATOMIC_RUNTIME.viteServer = {
			moduleGraph: {
				idToModuleMap: new Map([["src/app.tsx", {id: "src/app.tsx"}]]),
				invalidateModule,
			},
		};
		const plugin = createPlugin();
		await plugin.transform(".flex { display: flex }", "app.css");
		expect(invalidateModule).toHaveBeenCalled();
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
		const designSystem = {
			resource: "/tmp/app/node_modules/ui-latamwin/dist/Button.js",
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

		ATOMIC_RUNTIME.transpilePackages.add("ui-latamwin");
		loaderTap?.({}, designSystem);
		expect(designSystem.loaders[0]?.loader.replace(/\\/g, "/")).toMatch(
			/loader\.cjs$/,
		);

		await processAssets?.({
			"main.css": {source: () => ".flex { display: flex }"},
			"main.js": {source: () => `cn("flex")`},
			"index.html": {source: () => '<div class="flex"></div>'},
			"plain.txt": {source: () => "hello"},
			"buffer.js": {
				source: () => Buffer.from(`cn("flex")`).toString(),
			},
		});
		expect(updated["main.css"]).toContain("/*! tailwind-atomic */");
		expect(updated["main.js"]).toContain(ATOMIC_RUNTIME.classMap["flex"]);
		expect(updated["index.html"]).toContain(ATOMIC_RUNTIME.classMap["flex"]);
	});

	it("skips webpack context and assets that do not need work", async () => {
		process.env["TAILWIND_ATOMIC_PROJECT_ROOT"] = "/already";
		const plugin = createPlugin();
		const updated: Record<string, string> = {};
		let processAssets:
			| ((assets: Record<string, {source: () => string | {toString(): string}}>) => Promise<void>)
			| undefined;
		let loaderTap: ((ctx: unknown, module: unknown) => void) | undefined;

		class RawSource {
			constructor(public source: string) {}
		}

		plugin.webpack({
			context: "",
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
				beforeCompile: {tapPromise() {}},
				compilation: {
					tap(_name: string, fn: (compilation: unknown) => void) {
						fn({
							hooks: {
								processAssets: {
									tapPromise(
										_opts: unknown,
										cb: (assets: Record<string, {source: () => string | {toString(): string}}>) => Promise<void>,
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
		});

		expect(ATOMIC_RUNTIME.projectRoots).not.toContain("");
		expect(process.env["TAILWIND_ATOMIC_PROJECT_ROOT"]).toBe("/already");

		loaderTap?.({}, {resource: "/tmp/app.css", loaders: []});
		loaderTap?.({}, {
			resource: "/tmp/App.tsx",
			loaders: [{loader: 1}],
		});

		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";
		await processAssets?.({
			"plain.css": {source: () => ":root { color: red }"},
			"buffer.css": {
				source: () => ({toString: () => ".flex { display: flex }"}),
			},
			"lib.mjs": {source: () => `other("flex")`},
			"lib.cjs": {source: () => `cn("flex")`},
		});
		expect(updated["plain.css"]).toBeUndefined();
		expect(updated["buffer.css"]).toContain("/*! tailwind-atomic */");
		expect(updated["lib.mjs"]).toBeUndefined();
		expect(updated["lib.cjs"]).toContain(ATOMIC_RUNTIME.classMap["flex"]);
	});

	it("processes CSS before JS so a late class map still rewrites bundles", async () => {
		ATOMIC_RUNTIME.classMap = Object.create(null);
		ATOMIC_RUNTIME.classMap["__skip_warmup"] = "_skip";
		const plugin = createPlugin();
		const updated: Record<string, string> = {};
		let processAssets:
			| ((assets: Record<string, {source: () => string}>) => Promise<void>)
			| undefined;

		class RawSource {
			constructor(public source: string) {}
		}

		plugin.webpack({
			context: "/tmp/app",
			webpack: {
				Compilation: {PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE: 400},
				sources: {RawSource},
				NormalModule: {
					getCompilationHooks() {
						return {loader: {tap() {}}};
					},
				},
			},
			hooks: {
				beforeCompile: {tapPromise() {}},
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
		});

		await processAssets?.({
			"app/page.js": {source: () => `cn("flex")`},
			"static/chunks/app/layout.js": {
				source: () => `_jsx("div", { className: "relative flex flex-col p-4" })`,
			},
			"server/app/page.js": {
				source: () =>
					`_jsx("div", { className: "flex py-2 px-4 mx-auto" })`,
			},
			"main.css": {
				source: () =>
					".flex { display: flex } .relative { position: relative } .flex-col { flex-direction: column } .p-4 { padding: 1rem } .py-2 { padding-top: .5rem; padding-bottom: .5rem } .px-4 { padding-left: 1rem; padding-right: 1rem } .mx-auto { margin-left: auto; margin-right: auto }",
			},
		});

		expect(updated["main.css"]).toContain("/*! tailwind-atomic */");
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["py-2"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["px-4"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["mx-auto"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(updated["app/page.js"]).toContain(ATOMIC_RUNTIME.classMap["flex"]);
		expect(updated["app/page.js"]).not.toContain("flex");
		expect(updated["static/chunks/app/layout.js"]).toContain(
			ATOMIC_RUNTIME.classMap["flex"],
		);
		expect(updated["static/chunks/app/layout.js"]).not.toMatch(
			/\bflex-col\b/,
		);
		expect(updated["server/app/page.js"]).toContain(
			ATOMIC_RUNTIME.classMap["py-2"],
		);
		expect(updated["server/app/page.js"]).toContain(
			ATOMIC_RUNTIME.classMap["px-4"],
		);
		expect(updated["server/app/page.js"]).not.toMatch(/\b(py-2|px-4|mx-auto)\b/);
	});

	it("rehydrates an already-atomic CSS map before rewriting JS", async () => {
		const {code} = applyAtomicCss(".flex { display: flex }");
		const hashed = ATOMIC_RUNTIME.classMap["flex"];
		ATOMIC_RUNTIME.classMap = Object.create(null);
		ATOMIC_RUNTIME.classMap["__skip_warmup"] = "_skip";

		const plugin = createPlugin();
		const updated: Record<string, string> = {};
		let processAssets:
			| ((assets: Record<string, {source: () => string}>) => Promise<void>)
			| undefined;

		class RawSource {
			constructor(public source: string) {}
		}

		plugin.webpack({
			context: "/tmp/next15",
			webpack: {
				Compilation: {PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE: 400},
				sources: {RawSource},
				NormalModule: {
					getCompilationHooks() {
						return {loader: {tap() {}}};
					},
				},
			},
			hooks: {
				beforeCompile: {tapPromise() {}},
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
		});

		await processAssets?.({
			"server/app/page.js": {source: () => `cn("flex")`},
			"app.css": {source: () => code},
		});

		expect(ATOMIC_RUNTIME.classMap["flex"]).toBe(hashed);
		expect(updated["server/app/page.js"]).toContain(hashed);
		expect(updated["app.css"]).toBeUndefined();
	});

	it("does not atomicize webpack CSS assets that originate in node_modules", async () => {
		const plugin = createPlugin();
		const updated: Record<string, string> = {};
		let processAssets:
			| ((assets: Record<string, {source: () => string}>) => Promise<void>)
			| undefined;

		class RawSource {
			constructor(public source: string) {}
		}

		const slickChunk = {files: ["static/css/slick.css"]};
		plugin.webpack({
			context: "/tmp/app",
			webpack: {
				Compilation: {PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE: 400},
				sources: {RawSource},
				NormalModule: {
					getCompilationHooks() {
						return {loader: {tap() {}}};
					},
				},
			},
			hooks: {
				beforeCompile: {tapPromise() {}},
				compilation: {
					tap(_name: string, fn: (compilation: unknown) => void) {
						fn({
							chunks: [slickChunk],
							chunkGraph: {
								getChunkModules(chunk: {files?: string[]}) {
									if (chunk === slickChunk) {
										return [
											{
												resource:
													"D:\\repo\\node_modules\\slick-carousel\\slick\\slick.css",
											},
										];
									}
									return [];
								},
							},
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
		});

		const slick = ".slick-slide { display: none; } .slick-track { display: block; }";
		await processAssets?.({
			"static/css/slick.css": {source: () => slick},
			"main.css": {source: () => ".flex { display: flex } .p-4 { padding: 1rem }"},
		});

		expect(updated["static/css/slick.css"]).toBeUndefined();
		expect(updated["main.css"]).toContain("/*! tailwind-atomic */");
		expect(ATOMIC_RUNTIME.classMap["slick-slide"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
	});

	it("registers webpack watching so JS invalidation works in Next dev", async () => {
		const plugin = createPlugin();
		const invalidate = vi.fn();
		const watching = {invalidate};
		let watchRun: ((compiler: {watching?: {invalidate?: () => void}}) => void) | undefined;
		let watchClose: (() => void) | undefined;

		plugin.webpack({
			context: "/tmp/app",
			watching,
			webpack: {
				Compilation: {PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE: 400},
				sources: {RawSource: class {}},
				NormalModule: {
					getCompilationHooks() {
						return {loader: {tap() {}}};
					},
				},
			},
			hooks: {
				watchRun: {
					tap(_name: string, fn: (compiler: {watching?: {invalidate?: () => void}}) => void) {
						watchRun = fn;
					},
				},
				watchClose: {
					tap(_name: string, fn: () => void) {
						watchClose = fn;
					},
				},
				beforeCompile: {tapPromise() {}},
				compilation: {tap() {}},
			},
		});

		expect(ATOMIC_RUNTIME.webpackWatchings.has(watching)).toBe(true);
		watchRun?.({watching});
		invalidateJsModules();
		expect(invalidate).toHaveBeenCalled();
		watchClose?.();
		expect(ATOMIC_RUNTIME.webpackWatchings.has(watching)).toBe(false);
	});
});
