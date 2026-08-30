import postcss from "postcss";

import {ATOMIC_RUNTIME} from "../shared/constants";
import postcssTailwindAtomic from "../postcss";

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
});
