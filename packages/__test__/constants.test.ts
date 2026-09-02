import {
	ATOMIC_MARKER,
	ATOMIC_RUNTIME,
	CSS_ENTRY_CANDIDATES,
	DEFAULT_TARGET_FUNCTIONS,
	DEFAULT_PRESERVE_FUNCTIONS,
	NESTED_AT_RULES,
	TAILWIND_DIRECTIVE_RE,
} from "../shared/constants";

describe("constants", () => {
	it("exposes the atomic marker used to skip already processed CSS", () => {
		expect(ATOMIC_MARKER).toBe("/*! tailwind-atomic */");
	});

	it("detects Tailwind v3 directives and v4 imports", () => {
		expect(TAILWIND_DIRECTIVE_RE.test("@tailwind utilities;")).toBe(true);
		expect(TAILWIND_DIRECTIVE_RE.test('@import "tailwindcss";')).toBe(true);
		expect(TAILWIND_DIRECTIVE_RE.test('@import "tailwindcss/preflight";')).toBe(
			true,
		);
		expect(TAILWIND_DIRECTIVE_RE.test('@use "tailwindcss";')).toBe(true);
		expect(TAILWIND_DIRECTIVE_RE.test('@reference "tailwindcss";')).toBe(true);
		expect(TAILWIND_DIRECTIVE_RE.test(".flex { display: flex }")).toBe(false);
	});

	it("lists nested at-rules that should be walked", () => {
		expect(NESTED_AT_RULES).toEqual(
			new Set(["media", "supports", "container"]),
		);
	});

	it("includes the default class helper names", () => {
		expect(DEFAULT_TARGET_FUNCTIONS).toEqual(
			new Set([
				"clsx",
				"class",
				"classnames",
				"cn",
				"cx",
				"cva",
				"tw",
				"twMerge",
				"clsxMerge",
			]),
		);
	});

	it("shares a singleton runtime on globalThis", () => {
		expect(ATOMIC_RUNTIME.targetFunctions).toBeInstanceOf(Set);
		expect(ATOMIC_RUNTIME.classMap).toBeTypeOf("object");
		expect(ATOMIC_RUNTIME.viteServer).toBeNull();
		expect(ATOMIC_RUNTIME.webpackWatchings).toBeInstanceOf(Set);
		expect(ATOMIC_RUNTIME.transpilePackages).toBeInstanceOf(Set);
		expect(ATOMIC_RUNTIME.ignoreCss).toBeInstanceOf(Array);
		expect(ATOMIC_RUNTIME.preserveFunctions).toBeInstanceOf(Set);
		expect(DEFAULT_PRESERVE_FUNCTIONS.has("twIgnore")).toBe(true);
		expect(Array.isArray(ATOMIC_RUNTIME.projectRoots)).toBe(true);
		expect(CSS_ENTRY_CANDIDATES).toContain("app/globals.css");
		expect(CSS_ENTRY_CANDIDATES).toContain("src/index.css");
		expect(CSS_ENTRY_CANDIDATES).toContain("scss/styles.scss");
	});

	it("reuses the runtime already stored on globalThis", async () => {
		const first = ATOMIC_RUNTIME;
		vi.resetModules();
		const {ATOMIC_RUNTIME: second} = await import("../shared/constants");
		expect(second).toBe(first);
	});
});
