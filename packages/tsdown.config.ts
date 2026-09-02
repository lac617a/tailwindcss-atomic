import {defineConfig} from "tsdown";

export default defineConfig({
	entry: [
		"index.ts",
		"next.ts",
		"postcss.ts",
		"webpack.ts",
		"rollup.ts",
		"vite.ts",
		"astro.ts",
		"loader.ts",
		"esbuild.ts",
	],
	format: ["esm", "cjs"],
	platform: "node",
	clean: true,
	shims: true,
	dts: true,
	fixedExtension: true,
});
