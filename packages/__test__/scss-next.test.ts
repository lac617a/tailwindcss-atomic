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
	if (!css.includes("@tailwind")) return css;
	return `
.flex { display: flex }
.relative { position: relative }
.flex-col { flex-direction: column }
.p-4 { padding: 1rem }
`;
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
});
