import {parse} from "@babel/parser";
import generateImport from "@babel/generator";
import type {ExpressionStatement} from "@babel/types";

import {processArgument, processCvaCall} from "../core/process";

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
	box: "_box001",
	"box-border": "_bab75d",
	shadow: "_660aea _40fc51 _6d43b5",
	"shadow-sm": "_34ae1c _22d8f1",
	"shadow-md": "_shmd01",
	"shadow-neutral-950/25": "_dc1c5d _32febe",
	sm: "_smhash",
	md: "_mdhash",
	"mt-2": "_mt2001",
};

function rewrite(code: string) {
	const ast = parse(`(${code})`, {sourceType: "module"});
	const stmt = ast.program.body[0] as ExpressionStatement;
	processArgument(stmt.expression, classMap);
	return generate(ast).code;
}

function rewriteCva(code: string) {
	const ast = parse(code, {sourceType: "module"});
	const stmt = ast.program.body[0] as ExpressionStatement;
	const call = stmt.expression;
	if (call.type !== "CallExpression") throw new Error("expected call");
	processCvaCall(call.arguments, classMap);
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

	it("rewrites template interpolations (ternaries inside className templates)", () => {
		expect(
			rewrite(
				"`overflow-hidden duration-300 ${searchOpen ? \"p-6 hidden\" : \"flex\"}`",
			),
		).toMatch(/_bbbbbb[\s\S]*_cccccc[\s\S]*_aaaaaa/);
	});

	it("rewrites nested templates and parenthesized ternaries in interpolations", () => {
		const out = rewrite("`flex ${cond ? \"p-6\" : (\"hidden\")}`");
		expect(out).toContain("_aaaaaa");
		expect(out).toContain("_bbbbbb");
		expect(out).toContain("_cccccc");
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

describe("processCvaCall", () => {
	const source = `cva(["box", "box-border"], {
  variants: {
    shadow: {
      sm: ["shadow-sm", "shadow-neutral-950/25"],
      md: "shadow-md",
    },
  },
  defaultVariants: { shadow: "sm" },
  compoundVariants: [{ shadow: "sm", class: "mt-2" }],
});`;

	it("rewrites class values but never CVA config keys or variant names", () => {
		const out = rewriteCva(source);
		expect(out).toMatch(/\bshadow\s*:/);
		expect(out).toMatch(/\bsm\s*:/);
		expect(out).toMatch(/\bmd\s*:/);
		expect(out).not.toContain("_660aea");
		expect(out).not.toMatch(/\bshadow:\s*"_smhash"/);
		expect(out).toMatch(/defaultVariants:\s*\{\s*shadow:\s*["']sm["']/);
		expect(out).toMatch(/shadow:\s*["']sm["']/);
		expect(out).toContain("_box001");
		expect(out).toContain("_bab75d");
		expect(out).toContain("_34ae1c");
		expect(out).toContain("_shmd01");
		expect(out).toContain("_mt2001");
		expect(out).not.toMatch(/\bbox-border\b/);
		expect(out).not.toMatch(/\bshadow-sm\b/);
		expect(out).not.toMatch(/\bmt-2\b/);
	});

	it("emits JS that @babel/parser can parse", () => {
		const out = rewriteCva(source);
		expect(() => parse(out, {sourceType: "module"})).not.toThrow();
	});
});
