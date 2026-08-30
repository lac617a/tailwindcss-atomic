import {defineConfig} from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["__test__/**/*.test.ts"],
		setupFiles: ["__test__/setup.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov", "html"],
			reportsDirectory: "./coverage",
			include: [
				"core/**/*.ts",
				"core/**/*.js",
				"shared/**/*.ts",
				"*.ts",
			],
			exclude: [
				"__test__/**",
				"dist/**",
				"pkg/**",
				"coverage/**",
				"types.ts",
				"vitest.config.ts",
				"tsdown.config.ts",
				"core/wasm.js",
			],
		},
	},
});
