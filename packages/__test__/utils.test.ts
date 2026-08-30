import {parse} from "@babel/parser";
import type {CallExpression, ExpressionStatement} from "@babel/types";

import {getCalleeName, resolveWebpackLoaderPath} from "../shared/utils";

function calleeOf(code: string) {
	const ast = parse(code, {sourceType: "module"});
	const stmt = ast.program.body[0] as ExpressionStatement;
	const call = stmt.expression as CallExpression;
	return call.callee;
}

describe("getCalleeName", () => {
	it("returns null for missing callees", () => {
		expect(getCalleeName(null)).toBeNull();
		expect(getCalleeName(undefined)).toBeNull();
	});

	it("reads identifier callees", () => {
		expect(getCalleeName(calleeOf("cn('flex');"))).toBe("cn");
	});

	it("reads member expression callees", () => {
		expect(getCalleeName(calleeOf("clsx.merge('flex');"))).toBe("merge");
		expect(getCalleeName(calleeOf("obj['twMerge']('flex');"))).toBe("twMerge");
		expect(getCalleeName(calleeOf("fns[0]('flex');"))).toBe("0");
	});

	it("unwraps sequence expressions like Babel helpers", () => {
		expect(getCalleeName(calleeOf("(0, cn)('flex');"))).toBe("cn");
	});

	it("returns null for computed members that are not identifiers or literals", () => {
		expect(getCalleeName(calleeOf("obj[key]('flex');"))).toBe("key");
		expect(getCalleeName(calleeOf("obj[foo()]('flex');"))).toBeNull();
	});

	it("returns null for unsupported callee types", () => {
		expect(getCalleeName(calleeOf("(function () {})();"))).toBeNull();
	});
});

describe("resolveWebpackLoaderPath", () => {
	it("points at loader.cjs next to the compiled helpers", () => {
		const resolved = resolveWebpackLoaderPath();
		expect(resolved.replace(/\\/g, "/")).toMatch(/loader\.cjs$/);
	});
});
