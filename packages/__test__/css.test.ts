import postcss from "postcss";

import {ATOMIC_MARKER, ATOMIC_RUNTIME} from "../shared/constants";
import {
	applyAtomicCss,
	atomicizeContainer,
	collectSearchRoots,
	findCssEntry,
	findNearestPackageDir,
	isCssFile,
	mergeClassMap,
	transformClassString,
} from "../shared/css";
import {wasmMock} from "./helpers";

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
		expect(
			transformClassString("hover\\:bg-red-500", {
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

	it("unescapes CSS class names from the compiler", () => {
		expect(mergeClassMap({"hover\\:flex": "_dddddd"})).toBe(true);
		expect(ATOMIC_RUNTIME.classMap["hover:flex"]).toBe("_dddddd");
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
});

describe("atomicizeContainer", () => {
	it("returns false for empty roots", () => {
		const root = postcss.parse("");
		root.nodes = undefined as unknown as never;
		expect(atomicizeContainer(root)).toBe(false);
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
		expect(bases).toContain("/");

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

	it("walks nested folders, skips build dirs and stops at depth 4", () => {
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

	it("stops walking after four directory levels", () => {
		process.env["TAILWIND_ATOMIC_PROJECT_ROOT"] = "/repo";
		ATOMIC_RUNTIME.projectRoots = [];
		vi.spyOn(process, "cwd").mockReturnValue("/repo");

		const dirs: Record<string, string[]> = {
			"/repo": ["a"],
			"/repo/a": ["b"],
			"/repo/a/b": ["c"],
			"/repo/a/b/c": ["d"],
			"/repo/a/b/c/d": ["e"],
			"/repo/a/b/c/d/e": ["src"],
		};

		expect(
			findCssEntry(
				(p) => p === "/repo/a/b/c/d/e/src/index.css",
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
