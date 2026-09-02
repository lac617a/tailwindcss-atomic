import {parse} from "@babel/parser";

import {ATOMIC_RUNTIME} from "../shared/constants";
import {
	clearLinkedPackageCache,
	invalidateJsModules,
	isJsFile,
	shouldSkipJsTransform,
	transformJs,
} from "../shared/js";

describe("isJsFile", () => {
	it("accepts JS/TS extensions and query strings", () => {
		expect(isJsFile("src/app.ts")).toBe(true);
		expect(isJsFile("src/app.tsx")).toBe(true);
		expect(isJsFile("src/app.js")).toBe(true);
		expect(isJsFile("src/app.jsx?ts=1")).toBe(true);
		expect(isJsFile("lib/mod.mjs")).toBe(true);
		expect(isJsFile("lib\\mod.cjs")).toBe(true);
	});

	it("rejects CSS and empty ids", () => {
		expect(isJsFile("app.css")).toBe(false);
		expect(isJsFile("")).toBe(false);
		expect(isJsFile("?")).toBe(false);
	});
});

describe("shouldSkipJsTransform", () => {
	it("skips bundler output and foreign node_modules", () => {
		expect(shouldSkipJsTransform("")).toBe(true);
		expect(shouldSkipJsTransform("app/.next/server/app/page.js")).toBe(true);
		expect(shouldSkipJsTransform("node_modules/react/index.js")).toBe(true);
		expect(shouldSkipJsTransform("/tmp/app/node_modules/clsx/clsx.js")).toBe(
			true,
		);
	});

	it("keeps app source and transpilePackages / workspace design systems", () => {
		expect(shouldSkipJsTransform("src/app.tsx")).toBe(false);
		expect(shouldSkipJsTransform("packages/ui/button.tsx")).toBe(false);
		ATOMIC_RUNTIME.transpilePackages.add("ui-latamwin");
		expect(
			shouldSkipJsTransform("node_modules/ui-latamwin/dist/Button.js"),
		).toBe(false);
		expect(
			shouldSkipJsTransform(
				"/repo/node_modules/@webs/latamwin/dist/index.js",
			),
		).toBe(true);
		ATOMIC_RUNTIME.transpilePackages.add("@webs/latamwin");
		expect(
			shouldSkipJsTransform(
				"/repo/node_modules/@webs/latamwin/dist/index.js",
			),
		).toBe(false);
		clearLinkedPackageCache();
	});
});

describe("transformJs", () => {
	beforeEach(() => {
		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";
		ATOMIC_RUNTIME.classMap["p-6"] = "_bbbbbb";
		ATOMIC_RUNTIME.classMap["hidden"] = "_cccccc";
	});

	it("returns null when there is no code or no class map", () => {
		ATOMIC_RUNTIME.classMap = Object.create(null);
		expect(transformJs(`<div className="flex" />`, new Set(["cn"]))).toEqual({
			code: null,
			map: null,
		});
		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";
		expect(transformJs("", new Set(["cn"]))).toEqual({code: null, map: null});
	});

	it("rewrites JSX class and className string literals", () => {
		const result = transformJs(
			`export const n = <div className="flex p-6" class="flex" />;`,
			new Set(["cn"]),
		);
		expect(result.code).toContain("_aaaaaa _bbbbbb");
		expect(result.code).toContain('class="_aaaaaa"');
		expect(result.code).not.toContain("flex p-6");
	});

	it("rewrites JSX className expressions", () => {
		const result = transformJs(
			`export const n = <div className={"flex"} />;`,
			new Set(["cn"]),
		);
		expect(result.code).toContain("_aaaaaa");
	});

	it("rewrites target helper calls including templates, objects and arrays", () => {
		const result = transformJs(
			`
			cn("flex", cond && "p-6", cond ? "flex" : "hidden");
			cn(\`flex extra\`);
			cn({ flex: true, "p-6": false });
			cn(["flex", "p-6"]);
			`,
			new Set(["cn"]),
		);
		expect(result.code).toContain("_aaaaaa");
		expect(result.code).toContain("_bbbbbb");
		expect(result.code).toContain("_cccccc");
	});

	it("rewrites jsx runtime props for className and class", () => {
		const result = transformJs(
			`
			jsx("div", { className: "flex" });
			jsxs("div", { class: "p-6" });
			_jsx("div", { className: "flex" });
			_jsxs("div", { "className": "p-6" });
			jsxDEV("div", { className: "flex" });
			jsx("div", { ["className"]: "flex" });
			jsx("div", { id: "flex", ...rest });
			jsx("div", null);
			`,
			new Set(["cn"]),
		);
		expect(result.code).toContain("_aaaaaa");
		expect(result.code).toContain("_bbbbbb");
	});

	it("ignores JSX attributes that are not class or className", () => {
		const result = transformJs(
			`export const n = <div id="flex" data-class="p-6" />;`,
			new Set(["cn"]),
		);
		expect(result.code).toBeNull();
	});

	it("leaves strings inside preserveFunctions untouched", () => {
		const result = transformJs(
			`twIgnore("flex p-6"); cn("flex");`,
			new Set(["cn"]),
		);
		expect(result.code).toContain('twIgnore("flex p-6")');
		expect(result.code).toContain("_aaaaaa");
	});

	it("rewrites member callees whose property is a target helper", () => {
		const result = transformJs(`obj.cn("flex");`, new Set(["cn"]));
		expect(result.code).toContain("_aaaaaa");
	});

	it("rewrites extracted cva base arrays used via an identifier", () => {
		const result = transformJs(
			`
			var classNameDefault = ["flex", "p-6", "hidden"];
			var chipsCva = cva(classNameDefault, {
				variants: { size: { sm: ["flex"], md: "p-6" } },
			});
			export { chipsCva };
			`,
			new Set(["cva"]),
		);
		expect(result.code).toContain("_aaaaaa");
		expect(result.code).toContain("_bbbbbb");
		expect(result.code).toContain("_cccccc");
		expect(result.code).not.toMatch(/"flex"/);
		expect(result.code).not.toMatch(/"p-6"/);
		expect(result.code).not.toMatch(/"hidden"/);
	});

	it("rewrites Rollup preserveModules output with a 'use client' banner", () => {
		ATOMIC_RUNTIME.classMap["items-center"] = "_item01";
		ATOMIC_RUNTIME.classMap["justify-center"] = "_just02";
		ATOMIC_RUNTIME.classMap["whitespace-nowrap"] = "_white3";
		ATOMIC_RUNTIME.classMap["font-medium"] = "_font04";
		ATOMIC_RUNTIME.classMap["transition-colors"] = "_trans5";
		ATOMIC_RUNTIME.classMap["text-sm"] = "_cafc46 _ffc2a9";
		const result = transformJs(
			`'use client';\nimport { cva } from 'class-variance-authority';\nimport classNameVariantColorScheme from './classNameVariantColorScheme.js';\nvar classNameDefault = ["flex", "items-center", "justify-center", "whitespace-nowrap", "font-medium", "transition-colors"];\nvar chipsCva = cva(classNameDefault, {\n  variants: {\n    colorScheme: classNameVariantColorScheme,\n    size: { sm: ["text-sm"] }\n  }\n});\nexport { chipsCva };\n`,
			new Set(["cva"]),
		);
		expect(result.code).toContain("_aaaaaa");
		expect(result.code).toContain("_item01");
		expect(result.code).not.toMatch(/"flex"/);
		expect(result.code).not.toMatch(/"items-center"/);
	});

	it("rewrites exported variant objects that are not inlined into cva", () => {
		const result = transformJs(
			`
			const classNameVariantColorScheme = { default: "flex p-6", primary: "hidden" };
			export default classNameVariantColorScheme;
			`,
			new Set(["cva"]),
		);
		expect(result.code).toContain("_aaaaaa");
		expect(result.code).toContain("_bbbbbb");
		expect(result.code).toContain("_cccccc");
		expect(result.code).not.toMatch(/flex p-6/);
	});

	it("rewrites cva class values but leaves variant keys and names intact", () => {
		ATOMIC_RUNTIME.classMap["shadow"] = "_660aea _40fc51 _6d43b5";
		ATOMIC_RUNTIME.classMap["sm"] = "_smhash";
		ATOMIC_RUNTIME.classMap["box-border"] = "_bab75d";
		ATOMIC_RUNTIME.classMap["shadow-sm"] = "_34ae1c";
		ATOMIC_RUNTIME.classMap["mt-2"] = "_mt2001";
		const result = transformJs(
			`
			cva(["box", "box-border"], {
				variants: { shadow: { sm: ["shadow-sm"], md: "p-6 hidden" } },
				defaultVariants: { shadow: "sm" },
				compoundVariants: [{ shadow: "sm", class: "mt-2" }],
			});
			`,
			new Set(["cva"]),
		);
		expect(result.code).toContain("shadow:");
		expect(result.code).toMatch(/\bsm\s*:/);
		expect(result.code).toMatch(/\bmd\s*:/);
		expect(result.code).toContain("_bbbbbb");
		expect(result.code).toContain("_cccccc");
		expect(result.code).toContain("_bab75d");
		expect(result.code).toContain("_34ae1c");
		expect(result.code).toContain("_mt2001");
		expect(result.code).not.toContain("_660aea");
		expect(result.code).not.toMatch(/\bp-6\b/);
		expect(result.code).not.toMatch(/defaultVariants:\s*\{[^}]*_smhash/);
		expect(() =>
			parse(result.code ?? "", {sourceType: "module"}),
		).not.toThrow();
	});

	it("ignores helpers that are not in the target set", () => {
		const result = transformJs(`other("flex");`, new Set(["cn"]));
		expect(result.code).toBeNull();
	});

	it("returns null when parsing fails", () => {
		expect(transformJs("const x = {", new Set(["cn"]))).toEqual({
			code: null,
			map: null,
		});
	});
});

describe("invalidateJsModules", () => {
	it("no-ops without a Vite module graph", () => {
		expect(() => invalidateJsModules()).not.toThrow();
	});

	it("invalidates JS modules and skips CSS or empty entries", () => {
		const invalidateModule = vi.fn();
		ATOMIC_RUNTIME.viteServer = {
			moduleGraph: {
				idToModuleMap: new Map<string, unknown>([
					["src/app.tsx", {id: "src/app.tsx"}],
					["src/app.css", {id: "src/app.css"}],
					["src/empty.ts", null],
				]),
				invalidateModule,
			},
		};

		invalidateJsModules();
		expect(invalidateModule).toHaveBeenCalledTimes(1);
		expect(invalidateModule).toHaveBeenCalledWith({id: "src/app.tsx"});
	});

	it("invalidates webpack watchers in Next.js dev", () => {
		const invalidate = vi.fn();
		ATOMIC_RUNTIME.webpackWatchings.add({invalidate});
		invalidateJsModules();
		expect(invalidate).toHaveBeenCalledTimes(1);
	});

	it("ignores webpack watchers whose invalidate throws", () => {
		ATOMIC_RUNTIME.webpackWatchings.add({
			invalidate() {
				throw new Error("closed");
			},
		});
		expect(() => invalidateJsModules()).not.toThrow();
	});
});
