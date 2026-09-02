import {ATOMIC_RUNTIME} from "../shared/constants";
import {
	astroResourceType,
	isAstroFile,
	isHtmlFile,
	transformHtml,
} from "../shared/html";

describe("isHtmlFile", () => {
	it("accepts html extensions", () => {
		expect(isHtmlFile("index.html")).toBe(true);
		expect(isHtmlFile("pages/about.htm?v=1")).toBe(true);
		expect(isHtmlFile("app.tsx")).toBe(false);
		expect(isHtmlFile("")).toBe(false);
	});
});

describe("isAstroFile", () => {
	it("accepts .astro paths and Vite query strings", () => {
		expect(isAstroFile("src/pages/index.astro")).toBe(true);
		expect(
			isAstroFile("src/pages/index.astro?astro&type=script&index=0&lang.ts"),
		).toBe(true);
		expect(isAstroFile("src\\layouts\\Layout.astro")).toBe(true);
		expect(isAstroFile("index.html")).toBe(false);
		expect(isAstroFile("")).toBe(false);
	});
});

describe("astroResourceType", () => {
	it("reads style and script from the Vite query", () => {
		expect(astroResourceType("src/pages/index.astro")).toBe("template");
		expect(
			astroResourceType("src/pages/index.astro?astro&type=script&index=0"),
		).toBe("script");
		expect(
			astroResourceType(
				"src/pages/index.astro?astro&type=style&index=0&lang.css",
			),
		).toBe("style");
	});
});

describe("transformHtml", () => {
	beforeEach(() => {
		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";
		ATOMIC_RUNTIME.classMap["p-6"] = "_bbbbbb";
	});

	it("returns empty or unmapped markup unchanged", () => {
		ATOMIC_RUNTIME.classMap = Object.create(null);
		expect(transformHtml('<div class="flex"></div>')).toBe('<div class="flex"></div>');
		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";
		expect(transformHtml("")).toBe("");
	});

	it("rewrites class and className attributes", () => {
		expect(transformHtml('<div class="flex p-6" className="flex" id="flex"></div>')).toBe(
			'<div class="_aaaaaa _bbbbbb" className="_aaaaaa" id="flex"></div>',
		);
	});
});
