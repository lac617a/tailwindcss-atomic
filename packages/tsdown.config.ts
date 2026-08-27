import {defineConfig} from "tsdown";

export default defineConfig({
	entry: [
		"index.ts",
		"next.ts",
		"postcss.ts",
		"webpack.ts",
		"rollup.ts",
		"vite.ts",
	],
	format: ["esm", "cjs"],
	platform: "node",
	clean: true,
	shims: true,
	dts: false,
	fixedExtension: true,
	copy: ["index.d.ts", "next.d.ts", "postcss.d.ts"],
});
