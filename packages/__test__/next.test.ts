import type {Configuration} from "webpack";

import {withTailwindAtomic} from "../next";

describe("withTailwindAtomic", () => {
	it("injects turbopack loader rules for app source files", () => {
		const config = withTailwindAtomic();
		const rules = config.turbopack?.rules ?? {};
		expect(rules["*.tsx"]).toEqual({
			foreign: false,
			default: {
				loaders: [expect.stringMatching(/loader\.cjs$/)],
				as: "*",
			},
		});
		expect(rules["*.ts"]).toBeDefined();
		expect(rules["*.jsx"]).toBeDefined();
		expect(rules["*.js"]).toBeUndefined();
	});

	it("keeps user turbopack rules and calls the original webpack hook", () => {
		const webpack = vi.fn((cfg: Configuration) => cfg);
		const config = withTailwindAtomic({
			turbopack: {
				root: "/tmp/app",
				rules: {
					"*.svg": {loaders: ["svgo"], as: "*.js"},
				},
			},
			webpack,
		});

		expect(config.turbopack?.root).toBe("/tmp/app");
		expect(config.turbopack?.rules?.["*.svg"]).toEqual({
			loaders: ["svgo"],
			as: "*.js",
		});

		const webpackConfig: Configuration = {plugins: [], module: {rules: []}};
		const result = config.webpack?.(webpackConfig, {dev: true});
		expect(webpack).toHaveBeenCalledWith(webpackConfig, {dev: true});
		expect(result?.plugins?.length).toBeGreaterThan(0);
		expect(result?.module?.rules?.[0]).toMatchObject({
			enforce: "pre",
			use: [{loader: expect.stringMatching(/loader\.cjs$/)}],
		});
		if (process.platform === "win32") {
			expect(result?.cache).toEqual({type: "memory"});
		}
		expect(process.env["TAILWIND_ATOMIC_PROJECT_ROOT"]).toBe(process.cwd());
	});

	it("returns the webpack config when no user hook is provided", () => {
		const config = withTailwindAtomic({});
		const webpackConfig: Configuration = {};
		const result = config.webpack?.(webpackConfig, {dev: false});
		expect(result?.plugins).toHaveLength(1);
		expect(result?.cache).toBeUndefined();
	});
});
