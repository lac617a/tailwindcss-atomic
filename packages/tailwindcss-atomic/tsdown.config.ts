import {defineConfig} from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		next: "src/adapters/next.ts",
		postcss: "src/adapters/postcss.ts",
		webpack: "src/adapters/webpack.ts",
		rollup: "src/adapters/rollup.ts",
		vite: "src/adapters/vite.ts",
		astro: "src/adapters/astro.ts",
		loader: "src/adapters/loader.ts",
		esbuild: "src/adapters/esbuild.ts",
		"atomic-runtime": "src/runtime/atomic-runtime.ts",
	},
	format: ["esm", "cjs"],
	platform: "node",
	clean: true,
	shims: true,
	dts: true,
	fixedExtension: true,
});
