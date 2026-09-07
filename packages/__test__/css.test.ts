import postcss from "postcss";

import {ATOMIC_MARKER, ATOMIC_RUNTIME} from "../shared/constants";
import {
	applyAtomicCss,
	atomicizeContainer,
	isUtilityRule,
	looksLikeTailwindUtilityClass,
	collectSearchRoots,
	findCssEntries,
	findCssEntry,
	findNearestPackageDir,
	asPostcssPlugin,
	isCssFile,
	isViteCssJsWrapper,
	mergeClassMap,
	shouldIgnoreCss,
	normalizeTailwindSassDirectives,
	prepareWarmupSource,
	rehydrateClassMapFromCss,
	stripSassModuleRules,
	transformClassString,
} from "../shared/css";
import {defaultProcessTailwindCss, wasmMock} from "./helpers";

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

describe("asPostcssPlugin", () => {
	it("accepts PostCSS plugin functions and objects", () => {
		const fn = Object.assign(() => ({}), {postcss: true});
		expect(asPostcssPlugin(fn)).toBe(fn);
		expect(asPostcssPlugin({default: fn})).toBe(fn);
		const obj = {postcssPlugin: "x"};
		expect(asPostcssPlugin(obj)).toBe(obj);
	});

	it("rejects Tailwind CSS v4 default export", () => {
		function trap() {
			throw new Error("It looks like you're trying to use tailwindcss directly");
		}
		expect(asPostcssPlugin(trap)).toBeUndefined();
		expect(asPostcssPlugin({default: trap})).toBeUndefined();
		expect(asPostcssPlugin(undefined)).toBeUndefined();
	});
});

describe("isViteCssJsWrapper", () => {
	it("detects Vite HMR-injected CSS modules", () => {
		expect(isViteCssJsWrapper("import.meta.hot.accept()")).toBe(true);
		expect(isViteCssJsWrapper("updateStyle(id, css)")).toBe(true);
		expect(isViteCssJsWrapper('export default "body{}"')).toBe(true);
		expect(isViteCssJsWrapper(".flex { display: flex }")).toBe(false);
	});
});

describe("shouldIgnoreCss", () => {
	it("ignores node_modules on POSIX and Windows paths", () => {
		expect(shouldIgnoreCss("node_modules/slick-carousel/slick/slick.css")).toBe(
			true,
		);
		expect(
			shouldIgnoreCss("D:\\repo\\node_modules\\slick-carousel\\slick\\slick.css"),
		).toBe(true);
		expect(
			shouldIgnoreCss("/repo/node_modules/slick-carousel/slick/slick-theme.css"),
		).toBe(true);
		expect(
			shouldIgnoreCss("/repo/node_modules/.pnpm/slick-carousel@1.8.1/node_modules/slick-carousel/slick/slick.css"),
		).toBe(true);
		expect(shouldIgnoreCss("src/app/globals.css")).toBe(false);
		expect(shouldIgnoreCss(undefined)).toBe(false);
		expect(shouldIgnoreCss("")).toBe(false);
	});

	it("honors extra ignoreCss patterns", () => {
		ATOMIC_RUNTIME.ignoreCss.push("vendor/slick", /fontawesome/i);
		expect(shouldIgnoreCss("app/vendor/slick/slick.css")).toBe(true);
		expect(shouldIgnoreCss("src/vendor/fontAwesome/all.css")).toBe(true);
		expect(shouldIgnoreCss("src/app/globals.css")).toBe(false);
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

	it("preserves leading and trailing whitespace for template interpolations", () => {
		expect(transformClassString("flex p-6 ", classMap)).toBe("_aaaaaa _bbbbbb ");
		expect(transformClassString(" flex", classMap)).toBe(" _aaaaaa");
		expect(transformClassString(" \n\t ", classMap)).toBe(" \n\t ");
	});

	it("does not rewrite preserveClasses even if they are in the map", () => {
		ATOMIC_RUNTIME.preserveClasses.push("text-logo");
		expect(
			transformClassString("text-logo flex", {
				"text-logo": "_ffffff",
				flex: "_aaaaaa",
			}),
		).toBe("text-logo _aaaaaa");
	});

	it("falls back to unescaped keys", () => {
		expect(
			transformClassString("hover:bg-red-500", {
				"hover:bg-red-500": "_cccccc",
			}),
		).toBe("_cccccc");
		expect(
			transformClassString("hover\\:bg-red-500", {
				"hover:bg-red-500": "_cccccc",
			}),
		).toBe("_cccccc");
	});

	it("looks up important, stripped pseudos and case-insensitive hex", () => {
		expect(
			transformClassString("!px-4 disabled:py-2 fill-[#069BE8]", {
				"!px-4": "_imp001",
				"disabled:py-2": "_dis001",
				"fill-[#069be8]": "_hex001",
			}),
		).toBe("_imp001 _dis001 _hex001");
	});

	it("keeps quoted before/after content arbitrary values as one token", () => {
		expect(
			transformClassString(
				"relative before:absolute before:content-[''] after:content-['*']",
				{
					relative: "_rel001",
					"before:absolute": "_babs01",
					"before:content-['']": "_bemp01",
					"after:content-['*']": "_astar1",
				},
			),
		).toBe("_rel001 _babs01 _bemp01 _astar1");
		expect(
			transformClassString("before:content-['hello world'] flex", {
				"before:content-['hello world']": "_bhello",
				flex: "_aaaaaa",
			}),
		).toBe("_bhello _aaaaaa");
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

	it("unescapes CSS class names from the compiler", () => {
		expect(mergeClassMap({"hover\\:flex": "_dddddd"})).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["hover:flex"]).toBe("_dddddd");
	});

	it("normalizes important, trailing variant pseudos and hex case", () => {
		expect(mergeClassMap({"\\!px-4": "_imp001"})).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["!px-4"]).toBe("_imp001");
		expect(mergeClassMap({"disabled:py-2:disabled": "_dis001"})).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["disabled:py-2"]).toBe("_dis001");
		expect(mergeClassMap({"fill-[#069BE8]": "_hex001"})).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["fill-[#069be8]"]).toBe("_hex001");
	});
});

describe("applyAtomicCss", () => {
	it("leaves empty CSS, directives and already-atomic sheets alone", () => {
		expect(applyAtomicCss("")).toEqual({code: "", changed: false});
		expect(applyAtomicCss("@tailwind utilities;").changed).toBe(false);
		expect(applyAtomicCss("@use 'tailwindcss/utilities';").changed).toBe(false);
		expect(applyAtomicCss(`${ATOMIC_MARKER}\n._aaaaaa{display:flex}`).changed).toBe(
			false,
		);
	});

	it("atomicizes utility rules and stamps the marker", () => {
		const {code, changed} = applyAtomicCss(".flex { display: flex }");
		expect(changed).toBe(true);
		expect(code.startsWith(ATOMIC_MARKER)).toBe(true);
		expect(code).toContain("/*! tailwind-atomic-map ");
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(code).toContain(ATOMIC_RUNTIME.classMap["flex"]);
		expect(code).not.toContain(".flex {");
	});

	it("atomicizes before/after utilities and keeps the pseudo-element on the hashed selector", () => {
		const css = `
.before\\:block::before { content: var(--tw-content); display: block }
.after\\:content-\\[\\'\\'\\]::after { content: "" }
.flex { display: flex }
`;
		const {code, changed} = applyAtomicCss(css);
		expect(changed).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["before:block"]).toMatch(/^_[0-9a-f]{6}/);
		expect(ATOMIC_RUNTIME.classMap["after:content-['']"]).toMatch(
			/^_[0-9a-f]{6}/,
		);
		const beforeHash = ATOMIC_RUNTIME.classMap["before:block"]?.split(" ")[0];
		expect(code).toContain(`${beforeHash}::before`);
		expect(code).not.toContain(".before\\:block");
		const js = transformClassString(
			"before:block after:content-['']",
			ATOMIC_RUNTIME.classMap,
		);
		expect(js).toContain(ATOMIC_RUNTIME.classMap["before:block"]);
		expect(js).toContain(ATOMIC_RUNTIME.classMap["after:content-['']"]);
		expect(js).not.toContain("before:");
		expect(js).not.toContain("after:");
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
@supports (display: grid) {
  .p-6 { padding: 1.5rem; }
}
@container (min-width: 400px) {
  .hidden { display: none; }
}
@keyframes spin { from { transform: rotate(0) } }
`;
		const {code, changed} = applyAtomicCss(css);
		expect(changed).toBe(true);
		expect(code).toContain(":root");
		expect(code).toContain("@keyframes spin");
		expect(code).toContain("@media");
		expect(code).toContain("@supports");
		expect(code).toContain("@container");
		expect(ATOMIC_RUNTIME.classMap["flex"]).toBeDefined();
		expect(ATOMIC_RUNTIME.classMap["p-6"]).toBeDefined();
		expect(ATOMIC_RUNTIME.classMap["hidden"]).toBeDefined();
	});

	it("flattens nested @layer at-rules", () => {
		const {changed, code} = applyAtomicCss(`
@layer base {
  @layer utilities {
    .flex { display: flex; }
  }
}
`);
		expect(changed).toBe(true);
		expect(code).not.toContain("@layer");
	});

	it("falls back to PostCSS when WASM throws and warns once", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let shouldThrow = true;
		wasmMock.impl = (css: string) => {
			if (shouldThrow) {
				shouldThrow = false;
				throw new Error("RuntimeError: unreachable");
			}
			return defaultProcessTailwindCss(css);
		};

		const first = applyAtomicCss(".flex { display: flex }");
		expect(first.changed).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(first.code).not.toContain(".flex {");

		const second = applyAtomicCss(".p-4 { padding: 1rem }");
		expect(second.changed).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["p-4"]).toMatch(/^_[0-9a-f]{6}$/);

		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0]?.[0])).toContain("[tailwind-atomic]");
		expect(String(warn.mock.calls[0]?.[0])).toContain("unreachable");
		warn.mockRestore();
	});

	it("atomicizes Tailwind arbitrary values that contain escaped commas", () => {
		const css = `
.transition-\\[color\\,box-shadow\\] { transition-property: color, box-shadow }
.flex { display: flex }
`;
		const {code, changed} = applyAtomicCss(css);
		expect(changed).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(
			ATOMIC_RUNTIME.classMap["transition-[color,box-shadow]"],
		).toMatch(/^_[0-9a-f]{6}$/);
		expect(code).not.toContain(".flex {");
	});

	it("uses a full stylesheet from WASM when `css` is present", () => {
		wasmMock.impl = () => ({
			class_map: {flex: "_aaaaaa"},
			css_rules: ["._aaaaaa { display: flex }"],
			css: "._aaaaaa { display: flex }",
			changed: true,
		});
		const {code, changed} = applyAtomicCss(".flex { display: flex }");
		expect(changed).toBe(true);
		expect(code).toContain("._aaaaaa { display: flex }");
		expect(ATOMIC_RUNTIME.classMap["flex"]).toBe("_aaaaaa");
	});

	it("ignores a full-sheet WASM result that hashed custom component classes", () => {
		wasmMock.impl = (css: string) => {
			const class_map: Record<string, string> = {};
			if (css.includes("header-signin")) {
				class_map["header-signin"] = "_aaaaaa";
			}
			if (/(?:^|\{|\s)\.flex\b/.test(css) || css.includes(".flex {")) {
				class_map.flex = "_bbbbbb";
			}
			return {
				class_map,
				css_rules: class_map.flex ? ["._bbbbbb { display: flex }"] : [],
				css: css
					.replaceAll(".header-signin", "._aaaaaa")
					.replaceAll(".flex", "._bbbbbb"),
				changed: true,
			};
		};

		const {code, changed} = applyAtomicCss(`
.header-signin { position: relative; isolation: isolate; background-color: var(--primary) }
.header-signin::before { content: ""; position: absolute }
.header-signin::after { content: "" }
.flex { display: flex }
`);
		expect(changed).toBe(true);
		expect(code).toContain(".header-signin");
		expect(code).toContain("::before");
		expect(code).toContain("var(--primary)");
		expect(ATOMIC_RUNTIME.classMap["header-signin"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(code).not.toContain(".flex {");
	});

	it("keeps utilities when the compiler returns no replacement rules", () => {
		wasmMock.impl = () => ({class_map: {flex: "_aaaaaa"}, css_rules: null});
		const css = ".flex { display: flex }";
		const result = applyAtomicCss(css);
		expect(result.changed).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["flex"]).toBe("_aaaaaa");
	});

	it("no-ops when the compiler returns neither map nor rules", () => {
		wasmMock.impl = () => ({class_map: {}, css_rules: []});
		const css = ".flex { display: flex }";
		expect(applyAtomicCss(css)).toEqual({code: css, changed: false});
	});

	it("returns the original CSS when parsing fails", () => {
		expect(applyAtomicCss("{ this is not css").changed).toBe(false);
	});

	it("no-ops when there are no utility rules", () => {
		const css = ":root { color: red }";
		expect(applyAtomicCss(css)).toEqual({code: css, changed: false});
	});

	it("preserves skin token selectors after flattening @layer base", () => {
		const css = `
@layer base {
  .pokerenchile {
    --color-red-600: #bc0000;
    --color-revamp-primary-default: var(--color-red-600);
    --pattern-background: #121216b3;
  }
}
.bg-revamp-primary-default { background-color: var(--color-revamp-primary-default); }
.flex { display: flex; }
`;
		const {code, changed} = applyAtomicCss(css);
		expect(changed).toBe(true);
		expect(code).toMatch(
			/\.pokerenchile\s*\{[^}]*--color-red-600:\s*#bc0000/,
		);
		expect(code).toMatch(
			/\.pokerenchile\s*\{[^}]*--color-revamp-primary-default:\s*var\(--color-red-600\)/,
		);
		expect(code).toMatch(
			/\.pokerenchile\s*\{[^}]*--pattern-background:\s*#121216b3/,
		);
		expect(ATOMIC_RUNTIME.classMap["pokerenchile"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["bg-revamp-primary-default"]).toMatch(
			/^_[0-9a-f]{6}$/,
		);
		expect(code).not.toContain(".flex {");
		expect(code).not.toContain(".bg-revamp-primary-default");
		expect(code).toContain(
			`${ATOMIC_RUNTIME.classMap["bg-revamp-primary-default"]}`,
		);
		expect(code).toMatch(
			new RegExp(
				`\\._[0-9a-f]{6}[^{]*\\{[^}]*background-color:\\s*var\\(--color-revamp-primary-default\\)`,
			),
		);
		expect(code).not.toMatch(
			/\._[0-9a-f]{6}[^{]*\{[^}]*--color-revamp-primary-default:/,
		);
		expect(code).not.toMatch(/\._[0-9a-f]{6}[^{]*\{[^}]*--color-red-600:/);
		expect(code).not.toMatch(
			/\._[0-9a-f]{6}[^{]*\{[^}]*--pattern-background:/,
		);
	});

	it("preserves component/pseudo selectors and document theme roots", () => {
		const css = `
html:root, [data-theme] { background-color: var(--color-revamp-neutral-bg-surface-general-100); }
.pokerenchile .pattern-background::before { content: ""; background: var(--pattern-background); }
.flex { display: flex; }
`;
		const {code, changed} = applyAtomicCss(css);
		expect(changed).toBe(true);
		expect(code).toContain("html:root");
		expect(code).toContain("[data-theme]");
		expect(code).toContain(".pokerenchile .pattern-background::before");
		expect(ATOMIC_RUNTIME.classMap["pattern-background"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["pokerenchile"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
	});

	it("still atomicizes Tailwind --tw-* utilities and space/divide selectors", () => {
		const css = `
.from-red-500 {
  --tw-gradient-from: #ef4444 var(--tw-gradient-from-position);
  --tw-gradient-to: rgb(239 68 68 / 0) var(--tw-gradient-to-position);
  --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to);
}
.space-y-4 > :not([hidden]) ~ :not([hidden]) {
  --tw-space-y-reverse: 0;
  margin-top: calc(1rem * calc(1 - var(--tw-space-y-reverse)));
}
.hover\\:bg-red-500:hover { background-color: #ef4444; }
`;
		const {code, changed} = applyAtomicCss(css);
		expect(changed).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["from-red-500"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["space-y-4"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["hover:bg-red-500"]).toMatch(
			/^_[0-9a-f]{6}$/,
		);
		expect(code).toContain(":hover");
		expect(code).not.toContain(".from-red-500");
		expect(code).not.toContain(".space-y-4");
	});

	it("keeps mixed token + style decls on the semantic skin selector", () => {
		const css = `
.pokerenchile {
  --color-red-600: #bc0000;
  color: #bc0000;
  .pattern-background::before { content: ""; }
}
.flex { display: flex; }
`;
		const {code, changed} = applyAtomicCss(css);
		expect(changed).toBe(true);
		expect(code).toMatch(/\.pokerenchile\s*\{[^}]*--color-red-600:\s*#bc0000/);
		expect(code).toMatch(/\.pokerenchile\s*\{[^}]*color:\s*#bc0000/);
		expect(code).toContain(".pattern-background::before");
		expect(ATOMIC_RUNTIME.classMap["pokerenchile"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
	});

	it("atomicizes multi-decl spacing utilities and maps them", () => {
		const css = `
.py-2 { padding-top: .5rem; padding-bottom: .5rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.mx-auto { margin-left: auto; margin-right: auto; }
.flex { display: flex; }
.sm\\:px-4 { padding-left: 1rem; padding-right: 1rem; }
.\\!px-4 { padding-left: 1rem !important; padding-right: 1rem !important; }
.pokerenchile { --color-red-600: #bc0000; }
`;
		const {code, changed} = applyAtomicCss(css);
		expect(changed).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["py-2"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["px-4"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["mx-auto"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["sm:px-4"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["!px-4"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(code).not.toContain(".py-2");
		expect(code).not.toContain(".px-4");
		expect(code).not.toContain(".mx-auto");
		expect(code).toMatch(/\.pokerenchile\s*\{[^}]*--color-red-600:\s*#bc0000/);
		expect(ATOMIC_RUNTIME.classMap["pokerenchile"]).toBeUndefined();

		const rewritten = transformClassString(
			"flex py-2 px-4 mx-auto",
			ATOMIC_RUNTIME.classMap,
		);
		expect(rewritten).toContain(ATOMIC_RUNTIME.classMap["flex"]);
		expect(rewritten).toContain(ATOMIC_RUNTIME.classMap["py-2"]);
		expect(rewritten).toContain(ATOMIC_RUNTIME.classMap["px-4"]);
		expect(rewritten).toContain(ATOMIC_RUNTIME.classMap["mx-auto"]);
		expect(rewritten).not.toMatch(/\b(flex|py-2|px-4|mx-auto)\b/);
	});

	it("dedupes identical hashed rules inside one stylesheet", () => {
		const css = `
.top-0 { top: 0; }
.top-0 { top: 0; }
@media (min-width: 640px) {
  .sm\\:top-0 { top: 0; }
}
`;
		const {code, changed} = applyAtomicCss(css);
		expect(changed).toBe(true);
		const hashed = ATOMIC_RUNTIME.classMap["top-0"];
		expect(hashed).toMatch(/^_[0-9a-f]{6}$/);
		const matches = code.match(new RegExp(`\\.${hashed}\\s*\\{\\s*top:\\s*0`, "g"));
		expect(matches?.length).toBe(1);
	});

	it("rehydrates the class map from an already-atomic sheet", () => {
		const {code} = applyAtomicCss(".flex { display: flex }");
		const hashed = ATOMIC_RUNTIME.classMap["flex"];
		ATOMIC_RUNTIME.classMap = Object.create(null);

		const result = applyAtomicCss(code);
		expect(result.changed).toBe(false);
		expect(result.mapChanged).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["flex"]).toBe(hashed);
	});

	it("does not rehydrate when the atomic sheet has no map comment", () => {
		const css = `${ATOMIC_MARKER}\n._aaaaaa{display:flex}`;
		expect(applyAtomicCss(css)).toEqual({
			code: css,
			changed: false,
			mapChanged: false,
		});
	});

	it("keeps CSS module locals and still atomicizes Tailwind utilities", () => {
		const css = `
.Nexi_nexi__abc12 { position: relative; width: 160px; height: 160px; }
.Nexi_svg__def34 { display: block; width: 100%; height: 100%; }
.flex { display: flex; }
`;
		const {code, changed} = applyAtomicCss(css);
		expect(changed).toBe(true);
		expect(code).toContain(".Nexi_nexi__abc12");
		expect(code).toContain(".Nexi_svg__def34");
		expect(code).toContain("position: relative");
		expect(ATOMIC_RUNTIME.classMap["Nexi_nexi__abc12"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["Nexi_svg__def34"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(code).not.toContain(".flex {");
	});

	it("keeps unhashed CSS module locals and still atomicizes Tailwind in that file", () => {
		const css = `
.svg { display: block; width: 100% }
.body { fill: #fff; stroke: #000 }
.eyeLine { fill: none; stroke-width: 4 }
.flex { display: flex }
.p-4 { padding: 1rem }
`;
		const {code, changed} = applyAtomicCss(
			css,
			"app/components/nexi.module.css",
		);
		expect(changed).toBe(true);
		expect(code).toContain(".svg ");
		expect(code).toContain(".body ");
		expect(code).toContain(".eyeLine ");
		expect(ATOMIC_RUNTIME.classMap["svg"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["body"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["eyeLine"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["p-4"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(code).not.toContain(".flex ");
		expect(code).not.toContain(".p-4 ");
	});

	it("leaves vendor slick CSS untouched when from is node_modules", () => {
		const slick = `
.slick-slider { position: relative; display: block; }
.slick-list { overflow: hidden; }
.slick-track { position: relative; display: block; }
.slick-slide { display: none; float: left; height: 100%; min-height: 1px; }
.slick-initialized .slick-slide { display: block; }
.slick-arrow { position: absolute; }
.slick-dots { position: absolute; bottom: 0; }
.flex { display: flex; }
`;
		const skipped = applyAtomicCss(
			slick,
			"D:\\repo\\node_modules\\slick-carousel\\slick\\slick.css",
		);
		expect(skipped.changed).toBe(false);
		expect(skipped.code).toBe(slick);
		expect(skipped.code).toContain(".slick-slider");
		expect(skipped.code).toContain(".slick-track");
		expect(skipped.code).toContain(".slick-slide");
		expect(skipped.code).toContain(".slick-list");
		expect(skipped.code).not.toContain(ATOMIC_MARKER);
		expect(ATOMIC_RUNTIME.classMap["slick-slide"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["slick-slider"]).toBeUndefined();

		const app = applyAtomicCss(".flex { display: flex } .p-4 { padding: 1rem }", "src/app/globals.css");
		expect(app.changed).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["p-4"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(app.code).not.toMatch(/\.slick-/);
	});

	it("leaves custom hyphenated component classes intact", () => {
		const {code, changed} = applyAtomicCss(`
.header-signin { position: relative; isolation: isolate; background-color: var(--primary) }
.header-signin::before { content: ""; position: absolute }
.header-signin::after { content: "" }
.btn-notch { --btn-cut: 9px; clip-path: polygon(0 0, 100% 100%) }
.flex { display: flex }
.p-4 { padding: 1rem }
`);
		expect(changed).toBe(true);
		expect(code).toContain(".header-signin");
		expect(code).toContain("::before");
		expect(code).toContain(".btn-notch");
		expect(code).toContain("var(--primary)");
		expect(ATOMIC_RUNTIME.classMap["header-signin"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["btn-notch"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["p-4"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(code).not.toContain(".flex {");
	});

	it("leaves Tailwind-shaped custom classes listed in preserveClasses", () => {
		ATOMIC_RUNTIME.preserveClasses.push("text-logo", /^flex-container$/);
		const {code, changed} = applyAtomicCss(`
.text-logo { color: #111 }
.flex-container { display: flex; gap: 1rem }
.flex { display: flex }
`);
		expect(changed).toBe(true);
		expect(code).toContain(".text-logo");
		expect(code).toContain(".flex-container");
		expect(code).toContain("gap: 1rem");
		expect(code).not.toContain(".flex {");
		expect(ATOMIC_RUNTIME.classMap["text-logo"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["flex-container"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
	});

	it("discards a full-sheet WASM result that hashed preserveClasses", () => {
		ATOMIC_RUNTIME.preserveClasses.push("text-logo");
		wasmMock.impl = (css: string) => {
			const class_map: Record<string, string> = {};
			if (css.includes("text-logo")) {
				class_map["text-logo"] = "_aaaaaa";
			}
			if (/(?:^|\{|\s)\.flex\b/.test(css) || css.includes(".flex {")) {
				class_map.flex = "_bbbbbb";
			}
			return {
				class_map,
				css_rules: class_map.flex ? ["._bbbbbb { display: flex }"] : [],
				css: css
					.replaceAll(".text-logo", "._aaaaaa")
					.replaceAll(".flex", "._bbbbbb"),
				changed: true,
			};
		};
		const {code, changed} = applyAtomicCss(`
.text-logo { color: #111 }
.flex { display: flex }
`);
		expect(changed).toBe(true);
		expect(code).toContain(".text-logo");
		expect(code).not.toContain("._aaaaaa");
		expect(ATOMIC_RUNTIME.classMap["text-logo"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["flex"]).toBe("_bbbbbb");
	});

	it("keeps @supports color-mix utilities and rewrites from-primary/[0.05]", () => {
		const {code, changed} = applyAtomicCss(`
@supports (color:color-mix(in lab,red,red)) {
  .from-primary\\/\\[0\\.05\\] {
    --tw-gradient-from: color-mix(in oklab, var(--primary) 5%, transparent);
  }
}
.bg-gradient-to-b { background-image: linear-gradient(to bottom, var(--tw-gradient-stops)) }
.to-transparent { --tw-gradient-to: transparent }
`);
		expect(changed).toBe(true);
		expect(code).toContain("@supports");
		expect(code).toContain("color-mix");
		expect(ATOMIC_RUNTIME.classMap["from-primary/[0.05]"]).toMatch(
			/^_[0-9a-f]{6}/,
		);
		expect(code).not.toContain(".from-primary");
		const rewritten = transformClassString(
			"bg-gradient-to-b from-primary/[0.05] to-transparent",
			ATOMIC_RUNTIME.classMap,
		);
		expect(rewritten).toContain(ATOMIC_RUNTIME.classMap["from-primary/[0.05]"]);
		expect(rewritten).not.toContain("from-primary/[0.05]");
	});
});

describe("atomicizeContainer", () => {
	it("returns false for empty roots", () => {
		const root = postcss.parse("");
		root.nodes = undefined as unknown as never;
		expect(atomicizeContainer(root)).toBe(false);
	});
});

describe("isUtilityRule", () => {
	function firstRule(css: string) {
		const node = postcss.parse(css).nodes[0];
		if (!node) throw new Error("expected a CSS node");
		return isUtilityRule(node);
	}

	it("accepts typical Tailwind utilities", () => {
		expect(firstRule(".flex { display: flex }")).toBe(true);
		expect(firstRule(".bg-revamp-primary-default { background-color: var(--x) }")).toBe(
			true,
		);
		expect(
			firstRule(".hover\\:bg-red-500:hover { color: red }"),
		).toBe(true);
		expect(
			firstRule(
				".placeholder-gray-400::placeholder { color: #9ca3af }",
			),
		).toBe(true);
		expect(
			firstRule(".py-2 { padding-top: .5rem; padding-bottom: .5rem }"),
		).toBe(true);
		expect(
			firstRule(".px-4 { padding-left: 1rem; padding-right: 1rem }"),
		).toBe(true);
		expect(
			firstRule(".mx-auto { margin-left: auto; margin-right: auto }"),
		).toBe(true);
		expect(
			firstRule(".\\!px-4 { padding-left: 1rem !important; padding-right: 1rem !important }"),
		).toBe(true);
	});

	it("rejects theme tokens, component selectors and document roots", () => {
		expect(
			firstRule(".pokerenchile { --color-red-600: #bc0000 }"),
		).toBe(false);
		expect(
			firstRule(".pattern-background::before { content: \"\" }"),
		).toBe(false);
		expect(
			firstRule(".pokerenchile .child { color: red }"),
		).toBe(false);
		expect(
			firstRule("html.pokerenchile { --color-red-600: #bc0000 }"),
		).toBe(false);
		expect(firstRule(":root { --bg: white }")).toBe(false);
		expect(
			firstRule("[data-theme] { background-color: var(--x) }"),
		).toBe(false);
	});

	it("rejects CSS module local idents so bundled modules stay intact", () => {
		expect(
			firstRule(".Nexi_nexi__abc12 { position: relative; width: 160px }"),
		).toBe(false);
		expect(
			firstRule(".nexi_body__xK3p2 { fill: var(--fill); stroke: var(--ink) }"),
		).toBe(false);
		expect(
			firstRule(".nexi-module__svg___tQf2a { display: block }"),
		).toBe(false);
		expect(firstRule(".w-\\[1fr__2fr\\] { width: 1fr }")).toBe(true);
		expect(
			firstRule(
				".from-primary\\/\\[0\\.05\\] { --tw-gradient-from: color-mix(in oklab, var(--primary) 5%, transparent) }",
			),
		).toBe(true);
	});

	it("rejects custom hyphenated component classes", () => {
		expect(firstRule(".header-signin { color: red }")).toBe(false);
		expect(firstRule(".btn-notch { display: flex }")).toBe(false);
		expect(firstRule(".eye-line { width: 1px }")).toBe(false);
		expect(firstRule(".slick-slide { display: none }")).toBe(false);
		expect(firstRule(".pattern-background { position: relative }")).toBe(false);
	});
});

describe("looksLikeTailwindUtilityClass", () => {
	it("accepts Tailwind-shaped names including theme tokens and variants", () => {
		for (const name of [
			"flex",
			"p-4",
			"-mt-2",
			"items-center",
			"bg-revamp-primary-default",
			"hover:bg-red-500",
			"before:content-['']",
			"w-[327px]",
			"sr-only",
			"min-h-screen",
			"!px-4",
			"from-primary/[0.05]",
		]) {
			expect(looksLikeTailwindUtilityClass(name)).toBe(true);
		}
	});

	it("rejects BEM-style classes that only happen to contain a hyphen", () => {
		for (const name of [
			"header-signin",
			"btn-notch",
			"eye-line",
			"pokerenchile",
			"hover:header-signin",
		]) {
			expect(looksLikeTailwindUtilityClass(name)).toBe(false);
		}
	});

	it("rejects names listed in preserveClasses", () => {
		ATOMIC_RUNTIME.preserveClasses.push("text-logo", /^flex-container$/);
		expect(looksLikeTailwindUtilityClass("text-logo")).toBe(false);
		expect(looksLikeTailwindUtilityClass("flex-container")).toBe(false);
		expect(looksLikeTailwindUtilityClass("flex")).toBe(true);
	});
});

describe("CSS entry discovery", () => {
	const posix = {
		resolve: (...parts: string[]) => {
			const joined = parts
				.join("/")
				.replace(/\\/g, "/")
				.replace(/\/+/g, "/");
			if (joined.startsWith("/")) {
				return joined.replace(/\/\.\//g, "/");
			}
			return `/${joined}`.replace(/\/\.\//g, "/");
		},
		join: (...parts: string[]) => parts.join("/").replace(/\/+/g, "/"),
		dirname: (value: string) => {
			const clean = value.replace(/\/+$/, "");
			const i = clean.lastIndexOf("/");
			if (i <= 0) return "/";
			return clean.slice(0, i) || "/";
		},
		parse: (value: string) => ({root: "/"}),
	};

	it("collects unique ancestors from env, runtime roots and cwd", () => {
		process.env["TAILWIND_ATOMIC_PROJECT_ROOT"] = "/app";
		process.env["INIT_CWD"] = "/app";
		ATOMIC_RUNTIME.projectRoots = ["/app", "/app"];
		const cwd = vi.spyOn(process, "cwd").mockReturnValue("/app");

		const bases = collectSearchRoots(posix.resolve, posix.dirname, posix.parse);
		expect(bases[0]).toBe("/app");
		expect(new Set(bases).size).toBe(bases.length);

		cwd.mockRestore();
	});

	it("finds a candidate CSS file on a search root", () => {
		process.env["TAILWIND_ATOMIC_PROJECT_ROOT"] = "/app";
		ATOMIC_RUNTIME.projectRoots = [];
		vi.spyOn(process, "cwd").mockReturnValue("/app");

		const found = findCssEntry(
			(p) => p === "/app/src/index.css",
			() => [],
			() => ({isDirectory: () => false}),
			posix.resolve,
			posix.join,
			posix.dirname,
			posix.parse,
		);
		expect(found).toBe("/app/src/index.css");
		vi.restoreAllMocks();
	});

	it("walks nested folders and skips build dirs", () => {
		process.env["TAILWIND_ATOMIC_PROJECT_ROOT"] = "/repo";
		ATOMIC_RUNTIME.projectRoots = [];
		vi.spyOn(process, "cwd").mockReturnValue("/repo");

		const dirs: Record<string, string[]> = {
			"/repo": ["examples", "node_modules", ".git", "README.md", "blocked"],
			"/repo/examples": ["demo"],
			"/repo/examples/demo": ["src"],
			"/repo/examples/demo/src": [],
		};

		const found = findCssEntry(
			(p) => p === "/repo/examples/demo/src/index.css",
			(dir) => {
				if (dir === "/repo/blocked") throw new Error("eacces");
				return dirs[dir] ?? [];
			},
			(p) => {
				if (p.endsWith("README.md")) throw new Error("enoent");
				return {isDirectory: () => !p.endsWith(".css") && !p.endsWith(".md")};
			},
			posix.resolve,
			posix.join,
			posix.dirname,
			posix.parse,
		);
		expect(found).toBe("/repo/examples/demo/src/index.css");
		vi.restoreAllMocks();
	});

	it("stops walking after six directory levels", () => {
		process.env["TAILWIND_ATOMIC_PROJECT_ROOT"] = "/repo";
		ATOMIC_RUNTIME.projectRoots = [];
		vi.spyOn(process, "cwd").mockReturnValue("/repo");

		const dirs: Record<string, string[]> = {
			"/repo": ["a"],
			"/repo/a": ["b"],
			"/repo/a/b": ["c"],
			"/repo/a/b/c": ["d"],
			"/repo/a/b/c/d": ["e"],
			"/repo/a/b/c/d/e": ["f"],
			"/repo/a/b/c/d/e/f": ["g"],
			"/repo/a/b/c/d/e/f/g": ["src"],
		};

		expect(
			findCssEntry(
				(p) => p === "/repo/a/b/c/d/e/f/g/src/index.css",
				(dir) => dirs[dir] ?? [],
				() => ({isDirectory: () => true}),
				posix.resolve,
				posix.join,
				posix.dirname,
				posix.parse,
			),
		).toBeUndefined();
		vi.restoreAllMocks();
	});

	it("prefers explicit cssEntries over candidate discovery", () => {
		process.env["TAILWIND_ATOMIC_PROJECT_ROOT"] = "/app";
		ATOMIC_RUNTIME.projectRoots = [];
		ATOMIC_RUNTIME.cssEntries = ["scss/styles.scss"];
		vi.spyOn(process, "cwd").mockReturnValue("/app");

		const found = findCssEntries(
			(p) =>
				p === "/app/scss/styles.scss" || p === "/app/src/index.css",
			() => [],
			() => ({isDirectory: () => false}),
			posix.resolve,
			posix.join,
			posix.dirname,
			posix.parse,
		);
		expect(found[0]).toBe("/app/scss/styles.scss");
		expect(found).toContain("/app/src/index.css");
		vi.restoreAllMocks();
	});

	it("returns undefined when nothing matches", () => {
		process.env["TAILWIND_ATOMIC_PROJECT_ROOT"] = "/empty";
		ATOMIC_RUNTIME.projectRoots = [];
		vi.spyOn(process, "cwd").mockReturnValue("/empty");

		expect(
			findCssEntry(
				() => false,
				() => [],
				() => ({isDirectory: () => true}),
				posix.resolve,
				posix.join,
				posix.dirname,
				posix.parse,
			),
		).toBeUndefined();
		vi.restoreAllMocks();
	});

	it("finds the nearest package.json or falls back to the start dir", () => {
		expect(
			findNearestPackageDir(
				"/app/src",
				(p) => p === "/app/package.json",
				posix.join,
				posix.dirname,
				posix.parse,
			),
		).toBe("/app");

		expect(
			findNearestPackageDir(
				"/app/src",
				() => false,
				posix.join,
				posix.dirname,
				posix.parse,
			),
		).toBe("/app/src");
	});
});

describe("SCSS Tailwind v3 warmup helpers", () => {
	it("rewrites @use/@import/@reference of Tailwind layers to @tailwind", () => {
		expect(normalizeTailwindSassDirectives("@use 'tailwindcss/base';")).toBe(
			"@tailwind base;",
		);
		expect(
			normalizeTailwindSassDirectives('@use "tailwindcss/components" as *;'),
		).toBe("@tailwind components;");
		expect(
			normalizeTailwindSassDirectives("@use 'tailwindcss/utilities' as u;"),
		).toBe("@tailwind utilities;");
		expect(
			normalizeTailwindSassDirectives('@import "tailwindcss/preflight";'),
		).toBe("@tailwind base;");
		expect(
			normalizeTailwindSassDirectives('@reference "tailwindcss/utilities";'),
		).toBe("@tailwind utilities;");
	});

	it("leaves Tailwind v4 @import and local CSS alone", () => {
		expect(normalizeTailwindSassDirectives('@import "tailwindcss";')).toBe(
			'@import "tailwindcss";',
		);
		expect(normalizeTailwindSassDirectives(".flex { display: flex }")).toBe(
			".flex { display: flex }",
		);
	});

	it("strips local Sass module rules that PostCSS cannot resolve", () => {
		const css = `@tailwind utilities;\n@use './themes/brand' as themes;\n@forward './mixins';\n`;
		expect(stripSassModuleRules(css)).toBe("@tailwind utilities;\n\n\n");
	});

	it("prepares SCSS entries without sass by normalizing and stripping", () => {
		const prepared = prepareWarmupSource(
			"/app/scss/styles.scss",
			`@use 'tailwindcss/base';
@use 'tailwindcss/components';
@use 'tailwindcss/utilities';
@use './themes/brand' as themes;
`,
			(id: string) => {
				throw Object.assign(new Error(`Cannot find module '${id}'`), {
					code: "MODULE_NOT_FOUND",
				});
			},
		);
		expect(prepared).toContain("@tailwind base;");
		expect(prepared).toContain("@tailwind components;");
		expect(prepared).toContain("@tailwind utilities;");
		expect(prepared).not.toContain("@use");
	});

	it("compiles SCSS with sass when the optional peer is available", () => {
		const prepared = prepareWarmupSource(
			"/app/scss/styles.scss",
			"@use 'tailwindcss/utilities';\n@use './themes/brand' as themes;\n",
			(id: string) => {
				if (id === "sass") {
					return {
						compileString(source: string) {
							return {css: `${source}\n/* compiled */`};
						},
					};
				}
				throw new Error(`Cannot find module '${id}'`);
			},
		);
		expect(prepared).toContain("@tailwind utilities;");
		expect(prepared).toContain("/* compiled */");
		expect(prepared).not.toContain("@use");
	});

	it("uses sass-embedded when sass is missing", () => {
		const prepared = prepareWarmupSource(
			"/app/scss/styles.scss",
			"@use 'tailwindcss/utilities';\n",
			(id: string) => {
				if (id === "sass") throw new Error("missing");
				if (id === "sass-embedded") {
					return {
						default: {
							compileString(source: string) {
								return {css: source};
							},
						},
					};
				}
				throw new Error(`Cannot find module '${id}'`);
			},
		);
		expect(prepared).toContain("@tailwind utilities;");
	});

	it("skips Sass compilation for plain CSS entries", () => {
		const compileString = vi.fn();
		const prepared = prepareWarmupSource(
			"/app/app/globals.css",
			"@tailwind utilities;",
			(id: string) => {
				if (id === "sass") return {compileString};
				throw new Error(`Cannot find module '${id}'`);
			},
		);
		expect(compileString).not.toHaveBeenCalled();
		expect(prepared).toBe("@tailwind utilities;");
	});

	it("falls back when Sass compile throws", () => {
		const prepared = prepareWarmupSource(
			"/app/scss/styles.scss",
			"@use 'tailwindcss/utilities';\n@use './broken' as x;\n",
			(id: string) => {
				if (id === "sass") {
					return {
						compileString() {
							throw new Error("sass boom");
						},
					};
				}
				throw new Error(`Cannot find module '${id}'`);
			},
		);
		expect(prepared).toContain("@tailwind utilities;");
		expect(prepared).not.toContain("@use");
	});

	it("rehydrates a serialized class map from CSS comments", () => {
		const {code} = applyAtomicCss(".p-4 { padding: 1rem }");
		ATOMIC_RUNTIME.classMap = Object.create(null);
		expect(rehydrateClassMapFromCss(code)).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["p-4"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(rehydrateClassMapFromCss("._aaaaaa{}")).toBe(false);
		expect(rehydrateClassMapFromCss("/*! tailwind-atomic-map not-base64 */")).toBe(
			false,
		);
	});
});
