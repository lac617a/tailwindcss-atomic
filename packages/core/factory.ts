import {UnpluginFactory} from "unplugin";

import {ATOMIC_RUNTIME, DEFAULT_TARGET_FUNCTIONS} from "../shared/constants";

import type {OutputBundle} from "../types";
import {process_tailwind_css} from "./wasm";
import {resolveWebpackLoaderPath} from "../shared/utils";
import {
	isCssFile,
	mergeClassMap,
	applyAtomicCss,
	warmupClassMapFromCss,
	shouldIgnoreCss,
} from "../shared/css";
import {invalidateJsModules, isJsFile, shouldSkipJsTransform, transformJs} from "../shared/js";

export async function transformAtomicSource(code: string, id: string) {
	await warmupClassMapFromCss();
	if (!code || !id) return {code: null, map: null};

	const cleanId = String(id).split("?")[0]?.replace(/\\/g, "/");

	if (!cleanId || shouldSkipJsTransform(cleanId)) {
		return {code: null, map: null};
	}

	if (!isJsFile(cleanId)) return {code: null, map: null};

	return transformJs(code, ATOMIC_RUNTIME.targetFunctions);
}

function rewriteBundle(bundle: OutputBundle, targetFunctions: Set<string>) {
	for (const file of Object.values(bundle)) {
		if (file.type === "asset" && file.fileName.endsWith(".css")) {
			if (shouldIgnoreCss(file.fileName)) continue;
			const source =
				typeof file.source === "string" ? file.source : file.source.toString();
			const {code, changed} = applyAtomicCss(source, file.fileName);
			if (changed) {
				file.source = code;
			}
		}
	}

	for (const file of Object.values(bundle)) {
		if (file.type === "chunk" && typeof file.code === "string") {
			const result = transformJs(file.code, targetFunctions);
			if (result.code) {
				file.code = result.code;
			}
		}
	}
}

function assetText(asset: {source: () => string | {toString(): string}}) {
	const source = asset.source();
	return typeof source === "string" ? source : source.toString();
}

function isJsAssetName(fileName: string) {
	return /\.[cm]?js$/.test(fileName);
}

type WebpackCssModule = {resource?: string; userRequest?: string};

function cssModuleResource(module: WebpackCssModule) {
	return module.resource || module.userRequest || "";
}

function collectVendorOnlyCssAssets(compilation: {
	chunks?: Iterable<{files?: Iterable<string>}>;
	chunkGraph?: {getChunkModules(chunk: unknown): Iterable<unknown>};
}) {
	const vendorOnly = new Set<string>();
	if (!compilation.chunks || !compilation.chunkGraph) return vendorOnly;

	for (const chunk of compilation.chunks) {
		const cssFiles = [...(chunk.files ?? [])].filter((file) =>
			file.endsWith(".css"),
		);
		if (!cssFiles.length) continue;

		let cssModules = 0;
		let ignored = 0;
		for (const rawModule of compilation.chunkGraph.getChunkModules(chunk)) {
			const module = rawModule as WebpackCssModule;
			const resource = cssModuleResource(module);
			if (!resource) continue;
			if (!isCssFile(resource) && !/\.(css|scss|sass|less)(?:\?|$)/i.test(resource)) {
				continue;
			}
			cssModules++;
			if (shouldIgnoreCss(resource)) ignored++;
		}

		if (cssModules > 0 && ignored === cssModules) {
			for (const file of cssFiles) vendorOnly.add(file);
		}
	}

	return vendorOnly;
}

const factory: UnpluginFactory<{
	targetFunctions?: Set<string>;
	tailwindCss?: string;
	transpilePackages?: string[];
	ignoreCss?: Array<string | RegExp>;
}> = (options = {}) => {
	const targetFunctions = new Set(
		options.targetFunctions || DEFAULT_TARGET_FUNCTIONS,
	);
	ATOMIC_RUNTIME.targetFunctions = targetFunctions;
	if (options.transpilePackages) {
		for (const pkg of options.transpilePackages) {
			ATOMIC_RUNTIME.transpilePackages.add(pkg);
		}
	}
	if (options.ignoreCss?.length) {
		ATOMIC_RUNTIME.ignoreCss.push(...options.ignoreCss);
	}

	// Opcional: pre-cargar el mapa si alguien todavía pasa CSS compilado.
	if (options.tailwindCss) {
		const {class_map} = process_tailwind_css(options.tailwindCss);
		mergeClassMap(class_map);
	}

	function processCssAndMaybeInvalidate(css: string, from?: string) {
		const result = applyAtomicCss(css, from);

		if (result.mapChanged) invalidateJsModules();

		return result;
	}

	return {
		name: "tailwind-atomic-plugin",
		enforce: "post",

		async buildStart() {
			await warmupClassMapFromCss();
		},

		transformInclude(id) {
			if (!id) return false;

			const cleanId = id.split("?")[0]?.replace(/\\/g, "/");
			if (!cleanId) return false;

			if (isCssFile(cleanId)) {
				return !shouldIgnoreCss(cleanId) && !cleanId.includes("/.next/");
			}

			return isJsFile(cleanId) && !shouldSkipJsTransform(cleanId);
		},

		async transform(code, id) {
			await warmupClassMapFromCss();

			if (isCssFile(id)) {
				if (shouldIgnoreCss(id)) return null;
				// Vite already wrapped the file in the HMR injector (`updateStyle`).
				// Parsing that JS as CSS wipes the stylesheet → página en blanco y negro.
				if (
					code.includes("import.meta") ||
					code.includes("updateStyle") ||
					/^\s*(?:import|export)\b/.test(code)
				) {
					return null;
				}

				const {code: next, changed} = processCssAndMaybeInvalidate(code, id);
				if (!changed) return null;
				return {code: next, map: null};
			}

			if (isJsFile(id)) {
				const result = transformJs(code, targetFunctions);
				if (!result.code) return null;
				return result;
			}

			return null;
		},

		vite: {
			configResolved(config) {
				if (config.root) {
					ATOMIC_RUNTIME.projectRoots.unshift(config.root);
				}
			},
			configureServer(server) {
				ATOMIC_RUNTIME.viteServer = server;
			},
		},

		rollup: {
			generateBundle(_options, bundle) {
				rewriteBundle(bundle, targetFunctions);
			},
		},

		webpack(compiler) {
			if (typeof compiler.context === "string" && compiler.context) {
				process.env["TAILWIND_ATOMIC_PROJECT_ROOT"] ||= compiler.context;
				ATOMIC_RUNTIME.projectRoots.push(compiler.context);
			}

			const watching = (
				compiler as {watching?: {invalidate?: () => void}}
			).watching;
			if (watching) {
				ATOMIC_RUNTIME.webpackWatchings.add(watching);
			}

			compiler.hooks.watchRun?.tap("tailwind-atomic-plugin", (watchCompiler) => {
				const next =
					(watchCompiler as {watching?: {invalidate?: () => void}})
						.watching ??
					(compiler as {watching?: {invalidate?: () => void}}).watching;
				if (next) ATOMIC_RUNTIME.webpackWatchings.add(next);
			});

			compiler.hooks.watchClose?.tap("tailwind-atomic-plugin", () => {
				const current = (compiler as {watching?: {invalidate?: () => void}})
					.watching;
				if (current) ATOMIC_RUNTIME.webpackWatchings.delete(current);
			});

			compiler.hooks.beforeCompile.tapPromise(
				"tailwind-atomic-plugin",
				async () => {
					await warmupClassMapFromCss();
				},
			);

			const {Compilation, sources, NormalModule} = compiler.webpack;
			const {RawSource} = sources;
			const webpackLoaderPath = resolveWebpackLoaderPath();

			compiler.hooks.compilation.tap(
				"tailwind-atomic-plugin",
				(compilation) => {
					NormalModule.getCompilationHooks(compilation).loader.tap(
						"tailwind-atomic-plugin",
						(_loaderContext, module) => {
							const resource = module.resource;
							if (!resource || !isJsFile(resource)) return;
							if (shouldSkipJsTransform(resource)) {
								return;
							}

							const already = module.loaders.some(
								(loader) =>
									typeof loader.loader === "string" &&
									loader.loader.includes("loader.cjs"),
							);
							if (already) return;

							module.loaders.push({
								loader: webpackLoaderPath,
								ident: null,
								type: null,
							});
						},
					);

					compilation.hooks.processAssets.tapPromise(
						{
							name: "tailwind-atomic-plugin",
							stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE,
						},
						async (assets) => {
							await warmupClassMapFromCss();

							const vendorOnlyCss = collectVendorOnlyCssAssets(compilation);

							// CSS first so the class map is complete (and rehydrated
							// from already-atomic chunks) before any SSR/RSC JS rewrite.
							const cssFiles: string[] = [];
							const jsFiles: string[] = [];
							for (const fileName of Object.keys(assets)) {
								if (fileName.endsWith(".css")) cssFiles.push(fileName);
								else if (isJsAssetName(fileName)) jsFiles.push(fileName);
							}

							for (const fileName of cssFiles) {
								if (shouldIgnoreCss(fileName) || vendorOnlyCss.has(fileName)) {
									continue;
								}
								const asset = assets[fileName];
								if (!asset) continue;
								const {code, changed} = applyAtomicCss(
									assetText(asset),
									fileName,
								);
								if (changed) {
									compilation.updateAsset(fileName, new RawSource(code));
								}
							}

							for (const fileName of jsFiles) {
								const asset = assets[fileName];
								if (!asset) continue;
								const result = transformJs(
									assetText(asset),
									targetFunctions,
								);
								if (result.code) {
									compilation.updateAsset(
										fileName,
										new RawSource(result.code),
									);
								}
							}
						},
					);
				},
			);
		},
	};
};

export default factory;
