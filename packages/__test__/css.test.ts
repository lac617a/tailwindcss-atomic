import postcss from "postcss";

import {ATOMIC_MARKER, ATOMIC_RUNTIME} from "../shared/constants";
import {
	applyAtomicCss,
	atomicizeContainer,
	isCssFile,
	mergeClassMap,
	transformClassString,
} from "../shared/css";

describe("isCssFile", () => {
	it("accepts stylesheet extensions and strips queries", () => {
		expect(isCssFile("src/index.css")).toBe(true);
		expect(isCssFile("src/index.scss?direct")).toBe(true);
		expect(isCssFile("styles\\app.less")).toBe(true);
		expect(isCssFile("theme.styl")).toBe(true);
		expect(isCssFile("main.pcss")).toBe(true);
		expect(isCssFile("main.postcss")).toBe(true);
	});

	it("rejects CSS modules, JS, and empty ids", () => {
		expect(isCssFile("Button.module.css")).toBe(false);
		expect(isCssFile("Card.module.scss")).toBe(false);
		expect(isCssFile("app.tsx")).toBe(false);
		expect(isCssFile("")).toBe(false);
		expect(isCssFile("?")).toBe(false);
	});
});

describe("transformClassString", () => {
	const classMap = {flex: "_aaaaaa", "p-6": "_bbbbbb", "hover:bg-red-500": "_cccccc"};

	it("rewrites known classes and keeps the rest", () => {
		expect(transformClassString("flex p-6 hidden", classMap)).toBe(
			"_aaaaaa _bbbbbb hidden",
		);
	});

	it("returns empty input unchanged", () => {
		expect(transformClassString("", classMap)).toBe("");
	});

	it("falls back to unescaped keys", () => {
		expect(
			transformClassString("hover:bg-red-500", {
				"hover:bg-red-500": "_cccccc",
			}),
		).toBe("_cccccc");
	});
});

describe("mergeClassMap", () => {
	it("merges plain objects and reports changes", () => {
		expect(mergeClassMap({flex: "_aaaaaa"})).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["flex"]).toBe("_aaaaaa");
		expect(mergeClassMap({flex: "_aaaaaa"})).toBe(false);
	});

	it("accepts Map instances and skips empty values", () => {
		const asMap = new Map([
			["p-6", "_bbbbbb"],
			["gap-2", ""],
		]) as unknown as Record<string, string>;

		expect(mergeClassMap(asMap)).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["p-6"]).toBe("_bbbbbb");
		expect(ATOMIC_RUNTIME.classMap["gap-2"]).toBeUndefined();
	});

	it("returns an empty object when given a falsy map", () => {
		expect(mergeClassMap(undefined as unknown as Record<string, string>)).toBe(
			false,
		);
	});
});

describe("applyAtomicCss", () => {
	it("leaves empty CSS, directives and already-atomic sheets alone", () => {
		expect(applyAtomicCss("")).toEqual({code: "", changed: false});
		expect(applyAtomicCss("@tailwind utilities;").changed).toBe(false);
		expect(applyAtomicCss(`${ATOMIC_MARKER}\n._aaaaaa{display:flex}`).changed).toBe(
			false,
		);
	});

	it("atomicizes utility rules and stamps the marker", () => {
		const {code, changed} = applyAtomicCss(".flex { display: flex }");
		expect(changed).toBe(true);
		expect(code.startsWith(ATOMIC_MARKER)).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(code).toContain(ATOMIC_RUNTIME.classMap["flex"]);
		expect(code).not.toContain(".flex {");
	});

	it("flattens @layer wrappers before atomicizing utilities", () => {
		const {code, changed} = applyAtomicCss(`
@layer utilities {
  .flex { display: flex; }
}
@layer empty;
`);
		expect(changed).toBe(true);
		expect(code).not.toContain("@layer");
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
	});

	it("keeps non-utility rules and walks nested at-rules", () => {
		const css = `
:root { --bg: white; }
@media (min-width: 768px) {
  .flex { display: flex; }
}
@keyframes spin { from { transform: rotate(0) } }
`;
		const {code, changed} = applyAtomicCss(css);
		expect(changed).toBe(true);
		expect(code).toContain(":root");
		expect(code).toContain("@keyframes spin");
		expect(code).toContain("@media");
		expect(ATOMIC_RUNTIME.classMap["flex"]).toBeDefined();
	});

	it("returns the original CSS when parsing fails", () => {
		expect(applyAtomicCss("{ this is not css").changed).toBe(false);
	});

	it("no-ops when there are no utility rules", () => {
		const css = ":root { color: red }";
		expect(applyAtomicCss(css)).toEqual({code: css, changed: false});
	});
});

describe("atomicizeContainer", () => {
	it("returns false for empty roots", () => {
		const root = postcss.parse("");
		root.nodes = undefined as unknown as never;
		expect(atomicizeContainer(root)).toBe(false);
	});
});
