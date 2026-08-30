import {parse} from "@babel/parser";
import generateImport from "@babel/generator";
import type {ExpressionStatement} from "@babel/types";

import {processArgument} from "../core/process";

function interopDefault<T>(mod: T | {default: T}): T {
	let current: unknown = mod;
	while (current && typeof current === "object" && "default" in current) {
		current = (current as {default: unknown}).default;
	}
	return current as T;
}

const generate = interopDefault(generateImport);

const classMap = {
	flex: "_aaaaaa",
	"p-6": "_bbbbbb",
	hidden: "_cccccc",
};

function rewrite(code: string) {
	const ast = parse(`(${code})`, {sourceType: "module"});
	const stmt = ast.program.body[0] as ExpressionStatement;
	processArgument(stmt.expression, classMap);
	return generate(ast).code;
}

describe("processArgument", () => {
	it("returns false for missing nodes", () => {
		expect(processArgument(null, classMap)).toBe(false);
		expect(processArgument(undefined, classMap)).toBe(false);
	});

	it("rewrites string literals", () => {
		expect(rewrite(`"flex p-6"`)).toContain("_aaaaaa _bbbbbb");
	});

	it("rewrites template literals", () => {
		expect(rewrite("`flex extra`")).toContain("_aaaaaa extra");
	});

	it("skips empty template quasis and still rewrites cooked values", () => {
		const ast = parse("(`flex${x}`)", {sourceType: "module"});
		const stmt = ast.program.body[0] as ExpressionStatement;
		const tpl = stmt.expression as {quasis: {value: {raw: string; cooked: string | null}}[]};
		const empty = tpl.quasis[1];
		if (empty) empty.value.cooked = null;
		processArgument(stmt.expression, classMap);
		expect(generate(ast).code).toContain("_aaaaaa");
	});

	it("rewrites object keys (string and identifier)", () => {
		const out = rewrite(`{ flex: true, "p-6": false }`);
		expect(out).toContain("_aaaaaa");
		expect(out).toContain("_bbbbbb");
	});

	it("ignores spreads and computed object keys", () => {
		const out = rewrite(`{ ...extra, [dyn]: true, flex: true }`);
		expect(out).toContain("_aaaaaa");
		expect(out).toContain("...extra");
		expect(out).toContain("[dyn]");
	});

	it("walks arrays, conditionals and logical expressions", () => {
		expect(rewrite(`["flex", , cond && "p-6"]`)).toContain("_aaaaaa");
		expect(rewrite(`cond ? "flex" : "hidden"`)).toMatch(/_aaaaaa[\s\S]*_cccccc/);
		expect(rewrite(`cond ? 1 : "hidden"`)).toContain("_cccccc");
		expect(rewrite(`cond && "p-6"`)).toContain("_bbbbbb");
	});

	it("returns false for unsupported node types", () => {
		const ast = parse("1 + 1;", {sourceType: "module"});
		const stmt = ast.program.body[0] as ExpressionStatement;
		expect(processArgument(stmt.expression, classMap)).toBe(false);
	});
});
