import {ATOMIC_RUNTIME} from "../shared/constants";
import {isHtmlFile, transformHtml} from "../shared/html";

describe("isHtmlFile", () => {
	it("accepts html extensions", () => {
		expect(isHtmlFile("index.html")).toBe(true);
		expect(isHtmlFile("pages/about.htm?v=1")).toBe(true);
		expect(isHtmlFile("app.tsx")).toBe(false);
		expect(isHtmlFile("")).toBe(false);
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
