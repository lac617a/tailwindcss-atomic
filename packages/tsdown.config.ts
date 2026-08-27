import {defineConfig} from "tsdown";

export default defineConfig({
	entry: ["index.js", "next.js", "postcss.js"],
	format: ["esm", "cjs"],
	platform: "node",
	clean: true,
	shims: true,
	dts: false,
	fixedExtension: true,
	copy: ["index.d.ts", "next.d.ts", "postcss.d.ts"],
});
