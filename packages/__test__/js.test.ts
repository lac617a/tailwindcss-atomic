import {ATOMIC_RUNTIME} from "../shared/constants";
import {invalidateJsModules, isJsFile, transformJs} from "../shared/js";

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

	it("rewrites JSX className string literals", () => {
		const result = transformJs(
			`export const n = <div className="flex p-6" />;`,
			new Set(["cn"]),
		);
		expect(result.code).toContain("_aaaaaa _bbbbbb");
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

	it("ignores JSX attributes that are not className", () => {
		const result = transformJs(
			`export const n = <div id="flex" class="p-6" />;`,
			new Set(["cn"]),
		);
		expect(result.code).toBeNull();
	});

	it("rewrites member callees whose property is a target helper", () => {
		const result = transformJs(`obj.cn("flex");`, new Set(["cn"]));
		expect(result.code).toContain("_aaaaaa");
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
});
