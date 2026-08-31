import postcss from "postcss";

import {ATOMIC_MARKER, ATOMIC_RUNTIME} from "../shared/constants";
import {
	applyAtomicCss,
	prepareWarmupSource,
} from "../shared/css";
import {transformJs} from "../shared/js";

const SCSS_ENTRY = `@use 'tailwindcss/base';
@use "tailwindcss/components";
@use 'tailwindcss/utilities';
@use './themes/brand' as themes;
`;

const LAYOUT_JSX = `
export default function RootLayout() {
	return (
		<html className="relative flex flex-col p-4">
			<body className="flex p-4" />
		</html>
	);
}
`;

const RSC_JS = `_jsx("div", { className: "relative flex flex-col p-4" });
cn("flex", "p-4");
`;

function expandTailwind(css: string) {
	const utilities = `
.flex { display: flex }
.relative { position: relative }
.flex-col { flex-direction: column }
.p-4 { padding: 1rem }
`;
	if (!css.includes("@tailwind")) return css;
	return `${css.replace(/@tailwind\s+\w+\s*;/g, "")}\n${utilities}`;
}

function customPropsForSelector(css: string, selector: string) {
	const props: Record<string, string> = {};
	postcss.parse(css).walkRules((rule) => {
		const matches = postcss.list
			.comma(rule.selector)
			.some((part) => part.trim() === selector);
		if (!matches) return;
		rule.walkDecls((decl) => {
			if (decl.prop.startsWith("--")) props[decl.prop] = decl.value;
		});
	});
	return props;
}

function resolveCssVar(props: Record<string, string>, value: string) {
	const seen = new Set<string>();
	let current = value.trim();
	while (true) {
		const match = /^var\((--[\w-]+)\)\s*$/.exec(current);
		if (!match?.[1]) return current;
		if (seen.has(match[1])) return "";
		seen.add(match[1]);
		const next = props[match[1]];
		if (next == null || next === "") return "";
		current = next.trim();
	}
}

describe("Next 15 + Tailwind 3 + SCSS @use fixture", () => {
	it("atomicizes CSS and rewrites SSR/RSC JS after SCSS @use warmup", () => {
		const prepared = prepareWarmupSource(
			"/app/scss/styles.scss",
			SCSS_ENTRY,
			(id: string) => {
				throw Object.assign(new Error(`Cannot find module '${id}'`), {
					code: "MODULE_NOT_FOUND",
				});
			},
		);

		expect(prepared).toContain("@tailwind base;");
		expect(prepared).toContain("@tailwind utilities;");
		expect(prepared).not.toContain("@use");

		const expanded = expandTailwind(prepared);
		const {code, changed} = applyAtomicCss(expanded);
		expect(changed).toBe(true);
		expect(code).toContain(ATOMIC_MARKER);
		expect(code).toMatch(/\._[0-9a-f]{6}/);
		expect(code).not.toContain(".flex {");

		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["p-4"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(Object.keys(ATOMIC_RUNTIME.classMap).length).toBeGreaterThan(1);

		const layout = transformJs(LAYOUT_JSX, ATOMIC_RUNTIME.targetFunctions);
		expect(layout.code).toBeTruthy();
		expect(layout.code).toContain(ATOMIC_RUNTIME.classMap["flex"]);
		expect(layout.code).not.toMatch(/\bclassName="[^"]*\bflex\b/);

		const rsc = transformJs(RSC_JS, ATOMIC_RUNTIME.targetFunctions);
		expect(rsc.code).toContain(ATOMIC_RUNTIME.classMap["flex"]);
		expect(rsc.code).toContain(ATOMIC_RUNTIME.classMap["p-4"]);
		expect(rsc.code).not.toMatch(/\bflex-col\b/);
	});

	it("keeps the classic app/globals.css @tailwind path working", () => {
		const prepared = prepareWarmupSource(
			"/app/app/globals.css",
			"@tailwind base;\n@tailwind components;\n@tailwind utilities;",
			(id: string) => {
				throw new Error(`Cannot find module '${id}'`);
			},
		);
		expect(prepared).toContain("@tailwind utilities;");

		const {code, changed} = applyAtomicCss(expandTailwind(prepared));
		expect(changed).toBe(true);
		expect(code).toContain(ATOMIC_MARKER);
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
	});

	it("keeps pokerenchile skin tokens on html while hashing color utilities", () => {
		const scssEntry = `@use 'tailwindcss/base';
@use 'tailwindcss/components';
@use 'tailwindcss/utilities';
@use './themes/pokerenchile' as skin;
`;
		const prepared = prepareWarmupSource(
			"/app/scss/styles.scss",
			scssEntry,
			(id: string) => {
				if (id === "sass") {
					return {
						compileString(source: string) {
							return {
								css: source.replace(
									/@use '\.\/themes\/pokerenchile'[^;]*;/,
									`@layer base {
  .pokerenchile {
    --color-red-600: #bc0000;
    --color-revamp-primary-default: var(--color-red-600);
    --color-revamp-neutral-bg-surface-general-100: #121216;
    --pattern-background: #121216b3;
  }
}
html:root, [data-theme] {
  background-color: var(--color-revamp-neutral-bg-surface-general-100);
}
.pokerenchile .pattern-background::before {
  content: "";
  background: var(--pattern-background);
}
`,
								),
							};
						},
					};
				}
				throw Object.assign(new Error(`Cannot find module '${id}'`), {
					code: "MODULE_NOT_FOUND",
				});
			},
		);

		expect(prepared).toContain("@tailwind base;");
		expect(prepared).toContain("@tailwind utilities;");
		expect(prepared).not.toContain("@use");
		expect(prepared).toContain(".pokerenchile");

		const expanded = `${expandTailwind(prepared)}
.bg-revamp-primary-default { background-color: var(--color-revamp-primary-default); }
`;
		const {code, changed} = applyAtomicCss(expanded);
		expect(changed).toBe(true);

		const skinVars = customPropsForSelector(code, ".pokerenchile");
		expect(skinVars["--color-revamp-primary-default"]?.trim()).toBeTruthy();
		expect(resolveCssVar(skinVars, skinVars["--color-revamp-primary-default"] ?? "")).toBe(
			"#bc0000",
		);
		expect(code).toContain(".pokerenchile .pattern-background::before");
		expect(code).toContain("html:root");
		expect(code).toContain("[data-theme]");
		expect(ATOMIC_RUNTIME.classMap["pokerenchile"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["jackpot-play"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["bg-revamp-primary-default"]).toMatch(
			/^_[0-9a-f]{6}$/,
		);
		expect(code).toMatch(
			new RegExp(
				`\\.${ATOMIC_RUNTIME.classMap["bg-revamp-primary-default"]}[^{]*\\{[^}]*background-color:\\s*var\\(--color-revamp-primary-default\\)`,
			),
		);
		expect(code).not.toMatch(
			/\._[0-9a-f]{6}[^{]*\{[^}]*--color-revamp-primary-default:/,
		);

		const layout = transformJs(
			`
export default function RootLayout() {
	return (
		<html className={clsx(roboto.variable, "jackpot-play", process.env.theme, "flex")}>
			<body className="bg-revamp-primary-default" />
		</html>
	);
}
`,
			ATOMIC_RUNTIME.targetFunctions,
		);
		expect(layout.code).toContain("jackpot-play");
		expect(layout.code).toContain("process.env.theme");
		expect(layout.code).toContain(ATOMIC_RUNTIME.classMap["flex"]);
		expect(layout.code).toContain(
			ATOMIC_RUNTIME.classMap["bg-revamp-primary-default"],
		);
		expect(layout.code).not.toMatch(/\bclassName=\{clsx\([^)]*\bflex\b/);
		expect(layout.code).not.toContain("bg-revamp-primary-default");
	});

	it("rewrites multi-decl spacing utilities in SSR className strings", () => {
		const css = `
.pokerenchile { --color-revamp-primary-default: var(--color-red-600); --color-red-600: #bc0000; }
.py-2 { padding-top: .5rem; padding-bottom: .5rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.mx-auto { margin-left: auto; margin-right: auto; }
.flex { display: flex; }
.text-sm { font-size: 0.875rem; }
`;
		const {code, changed} = applyAtomicCss(css);
		expect(changed).toBe(true);
		expect(code).toContain(".pokerenchile");
		for (const util of ["flex", "py-2", "px-4", "mx-auto", "text-sm"]) {
			expect(ATOMIC_RUNTIME.classMap[util]).toMatch(/^_[0-9a-f]{6}$/);
		}

		const ssr = transformJs(
			`_jsx("div", { className: "flex py-2 px-4 mx-auto text-sm" });`,
			ATOMIC_RUNTIME.targetFunctions,
		);
		expect(ssr.code).not.toMatch(/\b(flex|py-2|px-4|mx-auto|text-sm)\b/);
		expect(ssr.code).toContain(ATOMIC_RUNTIME.classMap["py-2"]);
		expect(ssr.code).toContain(ATOMIC_RUNTIME.classMap["px-4"]);
	});
});
