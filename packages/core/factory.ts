import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import babelTraverse from "@babel/traverse";
import postcss from "postcss";

import {
	ATOMIC_RUNTIME,
	CSS_ENTRY_CANDIDATES,
	DEFAULT_TARGET_FUNCTIONS,
} from "../shared/constants";

import {process_tailwind_css} from "./wasm";
import {UnpluginFactory} from "unplugin";
import {invalidateJsModules} from "../shared/js";

const traverse = babelTraverse.default || babelTraverse;

export async function transformAtomicSource(code, id) {
	await warmupClassMapFromCss();
	if (!code || !id) return null;

	const cleanId = String(id).split("?")[0].replace(/\\/g, "/");
	if (cleanId.includes("node_modules") || cleanId.includes("/.next/")) {
		return null;
	}
	if (!isJsFile(cleanId)) return null;

	return transformJs(code, ATOMIC_RUNTIME.targetFunctions);
}

function rewriteBundle(bundle, targetFunctions) {
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
			if (result) {
				file.code = result.code;
			}
		}
	}
}

let warmupPromise;

async function warmupClassMapFromCss() {
	if (Object.keys(ATOMIC_RUNTIME.classMap).length > 0) return;
	if (warmupPromise) return warmupPromise;

	warmupPromise = (async () => {
		const {existsSync, readFileSync} = await import("node:fs");
		const {resolve, join} = await import("node:path");

		const cssPath = CSS_ENTRY_CANDIDATES.map((rel) =>
			resolve(process.cwd(), rel),
		).find((abs) => existsSync(abs));
		if (!cssPath) return;

		const appRequire = createRequire(join(process.cwd(), "package.json"));
		const plugins = [];
		try {
			const tw = appRequire("@tailwindcss/postcss");
			plugins.push(tw.default || tw);
		} catch {
			try {
				plugins.push(appRequire("tailwindcss"));
			} catch {
				return;
			}
		}

		plugins.push(postcssTailwindAtomic());
		const source = readFileSync(cssPath, "utf8");
		await postcss(plugins).process(source, {from: cssPath});
	})();

	return warmupPromise;
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

			const cleanId = id.split("?")[0].replace(/\\/g, "/");
			const normalizedCwd = process.cwd().replace(/\\/g, "/");

			if (cleanId.includes("node_modules") || cleanId.includes(".next")) {
				return false;
			}

			const isInside =
				cleanId.startsWith(normalizedCwd) ||
				id.replace(/\\/g, "/").startsWith(normalizedCwd);

			return isInside && (isCssFile(cleanId) || isJsFile(cleanId));
		},

		async transform(code, id) {
			await warmupClassMapFromCss();

			if (isCssFile(id)) {
				const {code: next, changed} = processCssAndMaybeInvalidate(code);
				if (!changed) return null;
				return {code: next, map: null};
			}

			if (isJsFile(id)) {
				return transformJs(code, targetFunctions);
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
									loader.loader.includes("webpack-loader.cjs"),
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
									if (result) {
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
