import {UnpluginFactory} from "unplugin";
import path from "node:path";

import {ATOMIC_RUNTIME, DEFAULT_TARGET_FUNCTIONS} from "../shared/constants";

import type {OutputBundle} from "../types";
import {process_tailwind_css} from "./wasm";
import {resolveWebpackLoaderPath} from "../shared/utils";
import {
	isCssFile,
	mergeClassMap,
	applyAtomicCss,
	warmupClassMapFromCss,
} from "../shared/css";
import {invalidateJsModules, isJsFile, transformJs} from "../shared/js";

export async function transformAtomicSource(code: string, id: string) {
	await warmupClassMapFromCss();
	if (!code || !id) return {code: null, map: null};

	const cleanId = String(id).split("?")[0]?.replace(/\\/g, "/");

	if (
		!cleanId ||
		cleanId.includes("node_modules") ||
		cleanId.includes("/.next/")
	) {
		return {code: null, map: null};
	}

	if (!isJsFile(cleanId)) return {code: null, map: null};

	return transformJs(code, ATOMIC_RUNTIME.targetFunctions);
}

function rewriteBundle(bundle: OutputBundle, targetFunctions: Set<string>) {
	for (const file of Object.values(bundle)) {
		if (file.type === "asset" && file.fileName.endsWith(".css")) {
			const source =
				typeof file.source === "string" ? file.source : file.source.toString();
			const {code, changed} = applyAtomicCss(source);
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

const factory: UnpluginFactory<{
	targetFunctions?: Set<string>;
	tailwindCss?: string;
}> = (options = {}) => {
	const targetFunctions = new Set(
		options.targetFunctions || DEFAULT_TARGET_FUNCTIONS,
	);
	ATOMIC_RUNTIME.targetFunctions = targetFunctions;

	// Opcional: pre-cargar el mapa si alguien todavía pasa CSS compilado.
	if (options.tailwindCss) {
		const {class_map} = process_tailwind_css(options.tailwindCss);
		mergeClassMap(class_map);
	}

	function processCssAndMaybeInvalidate(css: string) {
		const result = applyAtomicCss(css);

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

			if (cleanId.includes("node_modules") || cleanId.includes("/.next/")) {
				return false;
			}

			return isCssFile(cleanId) || isJsFile(cleanId);
		},

		async transform(code, id) {
			await warmupClassMapFromCss();

			if (isCssFile(id)) {
				const {code: next, changed} = processCssAndMaybeInvalidate(code);
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
							if (
								resource.includes("node_modules") ||
								resource.includes(`${path.sep}.next${path.sep}`)
							) {
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
							for (const [fileName, asset] of Object.entries(assets)) {
								const source = asset.source();
								const text =
									typeof source === "string" ? source : source.toString();

								if (fileName.endsWith(".css")) {
									const {code, changed} = applyAtomicCss(text);
									if (changed) {
										compilation.updateAsset(fileName, new RawSource(code));
									}
									continue;
								}

								if (/\.[cm]?js$/.test(fileName)) {
									const result = transformJs(text, targetFunctions);
									if (result.code) {
										compilation.updateAsset(
											fileName,
											new RawSource(result.code),
										);
									}
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
