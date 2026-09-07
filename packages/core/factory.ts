import {ATOMIC_RUNTIME, DEFAULT_TARGET_FUNCTIONS} from "../shared/constants";

import type {
	OutputBundle,
	UnpluginFactoryFunction,
	UnpluginFactoryOptions,
	WebpackCssModule,
} from "../types";
import {process_tailwind_css} from "./wasm";
import {resolveWebpackLoaderPath} from "../shared/utils";
import {
	isCssFile,
	isViteCssJsWrapper,
	mergeClassMap,
	applyAtomicCss,
	warmupClassMapFromCss,
	shouldIgnoreCss,
} from "../shared/css";
import {
	invalidateJsModules,
	isJsFile,
	shouldSkipJsTransform,
	transformJs,
} from "../shared/js";
import {
	astroResourceType,
	isAstroFile,
	isHtmlFile,
	transformHtml,
} from "../shared/html";
import {
	generateRuntimeModule,
	isAtomicRuntimeModule,
	isVirtualRuntimeLoadId,
	VIRTUAL_RUNTIME_IMPORT,
	VIRTUAL_RUNTIME_RESOLVED,
} from "../shared/virtual-runtime";

export async function transformAtomicSource(code: string, id: string) {
	if (!id) return {code: null, map: null};

	if (isAtomicRuntimeModule(id)) {
		await warmupClassMapFromCss();
		return {code: generateRuntimeModule(), map: null};
	}

	if (!code) return {code: null, map: null};

	const cleanId = String(id).split("?")[0]?.replace(/\\/g, "/");

	if (!cleanId || shouldSkipJsTransform(cleanId) || !isJsFile(cleanId)) {
		return {code: null, map: null};
	}

	await warmupClassMapFromCss();
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
		if (file.type === "asset" && file.fileName.endsWith(".html")) {
			const source =
				typeof file.source === "string" ? file.source : file.source.toString();
			const next = transformHtml(source);
			if (next !== source) {
				file.source = next;
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

function outputLibraryType(output: {
	library?: {type?: string} | string;
	libraryTarget?: string;
}) {
	const library = output.library;
	if (typeof library === "string") return library;
	if (library && typeof library === "object" && typeof library.type === "string") {
		return library.type;
	}
	if (typeof output.libraryTarget === "string") return output.libraryTarget;
	return undefined;
}

function isNodeLikeTarget(target: unknown) {
	const targets = Array.isArray(target) ? target : target == null ? [] : [target];
	return targets.some(
		(item) =>
			item === "node" ||
			item === "async-node" ||
			(typeof item === "string" &&
				(item.startsWith("node") || item.startsWith("async-node"))),
	);
}

/**
 * Webpack's default output is a script/CJS bundle, not ESM. Next's server
 * compiler uses `library.type = "commonjs2"` and `target: "node"`. Injecting a
 * bare `import` into those assets is a SyntaxError at "Collecting page data".
 */
function webpackEmitsEsm(
	compilation: {
		outputOptions?: {
			module?: boolean;
			library?: {type?: string} | string;
			libraryTarget?: string;
		};
	},
	compiler: {
		options?: {
			output?: {
				module?: boolean;
				library?: {type?: string} | string;
				libraryTarget?: string;
			};
			target?: unknown;
		};
	},
) {
	const output = {
		...(compiler.options?.output ?? {}),
		...(compilation.outputOptions ?? {}),
	};

	if (output.module === true) return true;

	const libraryType = outputLibraryType(output)?.toLowerCase();
	if (libraryType === "module" || libraryType === "modern-module") return true;
	if (libraryType) return false;
	if (isNodeLikeTarget(compiler.options?.target)) return false;
	return false;
}

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
			if (
				!isCssFile(resource) &&
				!/\.(css|scss|sass|less)(?:\?|$)/i.test(resource)
			) {
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

const factory: UnpluginFactoryFunction = (opts?: UnpluginFactoryOptions) => {
	const options = opts ?? {};

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
	if (options.preserveFunctions) {
		ATOMIC_RUNTIME.preserveFunctions = new Set(options.preserveFunctions);
	}
	if (options.classMapFile === false) {
		ATOMIC_RUNTIME.classMapFile = false;
	} else if (typeof options.classMapFile === "string") {
		ATOMIC_RUNTIME.classMapFile = options.classMapFile;
	}
	if (options.cssEntries?.length) {
		ATOMIC_RUNTIME.cssEntries.push(...options.cssEntries);
	}

	const transformEmittedJs = options.transformEmittedJs === true;

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

		resolveId(id: string) {
			const clean = String(id).split("?")[0] ?? id;
			if (clean === VIRTUAL_RUNTIME_IMPORT || clean === VIRTUAL_RUNTIME_RESOLVED) {
				return VIRTUAL_RUNTIME_RESOLVED;
			}
		},

		loadInclude(id: string) {
			return isVirtualRuntimeLoadId(id);
		},

		load(id: string) {
			if (isVirtualRuntimeLoadId(id)) {
				return generateRuntimeModule();
			}
		},

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

			if (isHtmlFile(cleanId) || isAstroFile(cleanId)) {
				return true;
			}

			return isJsFile(cleanId) && !shouldSkipJsTransform(cleanId);
		},

		async transform(code, id) {
			await warmupClassMapFromCss();

			if (isCssFile(id)) {
				if (shouldIgnoreCss(id)) return null;
				// Vite already wrapped the file in the HMR injector (`updateStyle`).
				// Parsing that JS as CSS wipes the stylesheet → página en blanco y negro.
				if (isViteCssJsWrapper(code)) {
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

			if (isHtmlFile(id)) {
				const next = transformHtml(code);
				if (next === code) return null;
				return {code: next, map: null};
			}

			if (isAstroFile(id)) {
				if (astroResourceType(id) === "style") {
					if (shouldIgnoreCss(id) || isViteCssJsWrapper(code)) {
						return null;
					}
					const {code: next, changed} = processCssAndMaybeInvalidate(code, id);
					if (!changed) return null;
					return {code: next, map: null};
				}

				let next = transformHtml(code);
				if (!shouldSkipJsTransform(id)) {
					const result = transformJs(next, targetFunctions);
					if (result.code) next = result.code;
				}
				if (next === code) return null;
				return {code: next, map: null};
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
			transformIndexHtml(html) {
				return transformHtml(html);
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

			const watching = (compiler as {watching?: {invalidate?: () => void}})
				.watching;
			if (watching) {
				ATOMIC_RUNTIME.webpackWatchings.add(watching);
			}

			compiler.hooks.watchRun?.tap(
				"tailwind-atomic-plugin",
				(watchCompiler) => {
					const next =
						(watchCompiler as {watching?: {invalidate?: () => void}})
							.watching ??
						(compiler as {watching?: {invalidate?: () => void}}).watching;
					if (next) ATOMIC_RUNTIME.webpackWatchings.add(next);
				},
			);

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
							const rewriteEmittedJs =
								transformEmittedJs && webpackEmitsEsm(compilation, compiler);

							// CSS first so the class map is complete (and rehydrated
							// from already-atomic chunks) before any optional JS rewrite.
							// Source JS is transformed by the loader; rewriting emitted
							// JS is opt-in and skipped for CommonJS/Node output.
							const cssFiles: string[] = [];
							const htmlFiles: string[] = [];
							const jsFiles: string[] = [];
							for (const fileName of Object.keys(assets)) {
								if (fileName.endsWith(".css")) cssFiles.push(fileName);
								else if (fileName.endsWith(".html")) htmlFiles.push(fileName);
								else if (rewriteEmittedJs && isJsAssetName(fileName)) {
									jsFiles.push(fileName);
								}
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

							for (const fileName of htmlFiles) {
								const asset = assets[fileName];
								if (!asset) continue;
								const source = assetText(asset);
								const next = transformHtml(source);
								if (next !== source) {
									compilation.updateAsset(fileName, new RawSource(next));
								}
							}

							for (const fileName of jsFiles) {
								const asset = assets[fileName];
								if (!asset) continue;
								const result = transformJs(assetText(asset), targetFunctions);
								if (result.code) {
									compilation.updateAsset(fileName, new RawSource(result.code));
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
