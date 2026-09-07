import postcss from "postcss";

import {ATOMIC_RUNTIME} from "../shared/constants";
import postcssTailwindAtomic from "../postcss";

const SLICK_CSS = `
.slick-slider { position: relative; display: block; box-sizing: border-box; }
.slick-list { position: relative; overflow: hidden; display: block; margin: 0; padding: 0; }
.slick-track { position: relative; left: 0; top: 0; display: block; }
.slick-slide { display: none; float: left; height: 100%; min-height: 1px; }
.slick-initialized .slick-slide { display: block; }
.slick-arrow { position: absolute; top: 50%; }
.slick-dots { position: absolute; bottom: 0; list-style: none; }
`;

/** Locals as PostCSS sees them: css-loader has not renamed them to `nexi_svg__hash` yet. */
const NEXI_MODULE_CSS = `
.svg { display: block; width: 100% }
.plate { fill: none }
.body { fill: #fff; stroke: #000 }
.eyeLine { fill: none; stroke-width: 4 }
.tongue { fill: var(--c-red) }
.fx { pointer-events: none }
.figure .limbs rect { fill: var(--c-red) }
`;

describe("postcss plugin", () => {
	it("declares itself as a PostCSS plugin", () => {
		expect(postcssTailwindAtomic.postcss).toBe(true);
		expect(postcssTailwindAtomic().postcssPlugin).toBe("postcss-tailwind-atomic");
	});

	it("replaces utility CSS with atomic rules", async () => {
		const result = await postcss([postcssTailwindAtomic()]).process(
			".flex { display: flex }",
			{from: undefined},
		);
		expect(result.css).toContain("/*! tailwind-atomic */");
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(result.css).not.toContain(".flex {");
	});

	it("honors preserveClasses for Tailwind-shaped custom names", async () => {
		const result = await postcss([
			postcssTailwindAtomic({preserveClasses: ["text-logo"]}),
		]).process(".text-logo { color: #111 } .flex { display: flex }", {
			from: "src/app.css",
		});
		expect(result.css).toContain(".text-logo");
		expect(result.css).not.toContain(".flex {");
		expect(ATOMIC_RUNTIME.classMap["text-logo"]).toBeUndefined();
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
	});

	it("leaves CSS without utilities unchanged", async () => {
		const css = ":root { color: red }";
		const result = await postcss([postcssTailwindAtomic()]).process(css, {
			from: undefined,
		});
		expect(result.css).toContain(":root");
		expect(result.css).not.toContain("/*! tailwind-atomic */");
	});

	it("invalidates JS modules when the class map changes", async () => {
		const invalidateModule = vi.fn();
		ATOMIC_RUNTIME.viteServer = {
			moduleGraph: {
				idToModuleMap: new Map([["src/app.tsx", {id: "src/app.tsx"}]]),
				invalidateModule,
			},
		};

		await postcss([postcssTailwindAtomic()]).process(".p-6 { padding: 1.5rem }", {
			from: undefined,
		});
		expect(invalidateModule).toHaveBeenCalled();
	});

	it("does not atomicize slick-carousel CSS from node_modules", async () => {
		const posix = await postcss([postcssTailwindAtomic()]).process(SLICK_CSS, {
			from: "/repo/node_modules/slick-carousel/slick/slick.css",
		});
		expect(posix.css).toContain(".slick-slider");
		expect(posix.css).toContain(".slick-track");
		expect(posix.css).toContain(".slick-slide");
		expect(posix.css).toContain(".slick-list");
		expect(posix.css).not.toContain("/*! tailwind-atomic */");
		expect(posix.css).not.toMatch(/\._[0-9a-f]{6}/);
		expect(ATOMIC_RUNTIME.classMap["slick-slide"]).toBeUndefined();

		const win = await postcss([postcssTailwindAtomic()]).process(SLICK_CSS, {
			from: "D:\\repo\\node_modules\\slick-carousel\\slick\\slick-theme.css",
		});
		expect(win.css).toContain(".slick-slider");
		expect(win.css).not.toContain("/*! tailwind-atomic */");

		const app = await postcss([postcssTailwindAtomic()]).process(
			".flex { display: flex } .p-4 { padding: 1rem }",
			{from: "src/app/globals.css"},
		);
		expect(app.css).toContain("/*! tailwind-atomic */");
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["p-4"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(app.css).not.toContain(".flex {");
	});

	it("atomicizes Tailwind utilities inside CSS modules without eating locals", async () => {
		const result = await postcss([postcssTailwindAtomic()]).process(
			`${NEXI_MODULE_CSS}\n.flex { display: flex }\n.p-4 { padding: 1rem }\n`,
			{from: "D:\\repo\\app\\components\\nexi.module.css"},
		);

		for (const local of ["svg", "body", "eyeLine", "fx", "plate", "tongue"]) {
			expect(result.css).toContain(`.${local} `);
			expect(ATOMIC_RUNTIME.classMap[local]).toBeUndefined();
		}
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(ATOMIC_RUNTIME.classMap["p-4"]).toMatch(/^_[0-9a-f]{6}$/);
		expect(result.css).toContain("/*! tailwind-atomic */");
		expect(result.css).not.toContain(".flex {");
		expect(result.css).not.toContain(".p-4 {");

		const localsOnly = await postcss([postcssTailwindAtomic()]).process(
			NEXI_MODULE_CSS,
			{from: "/repo/app/components/nexi.module.scss?raw"},
		);
		expect(localsOnly.css).toContain(".tongue ");
		expect(localsOnly.css).toContain(".svg ");
		expect(localsOnly.css).not.toContain("/*! tailwind-atomic */");
	});
});
