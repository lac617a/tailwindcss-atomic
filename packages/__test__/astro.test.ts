import factory from "../core/factory";
import astro from "../astro";
import vite from "../vite";
import {ATOMIC_RUNTIME} from "../shared/constants";
import {transformViteCss} from "../shared/vite-css";

type Plugin = ReturnType<typeof factory>;

function createPlugin() {
	return factory({}) as Plugin & {
		transformInclude: (id: string) => boolean;
		transform: (
			code: string,
			id: string,
		) => Promise<{code: string} | null>;
	};
}

describe("tailwindAtomicAstro", () => {
	it("injects the Vite CSS + JS plugins through astro:config:setup", () => {
		const integration = astro();
		expect(integration.name).toBe("tailwindcss-atomic");

		const updateConfig = vi.fn();
		integration.hooks["astro:config:setup"]({updateConfig});

		expect(updateConfig).toHaveBeenCalledTimes(1);
		const plugins = updateConfig.mock.calls[0]?.[0]?.vite?.plugins as
			| ReturnType<typeof vite>
			| undefined;
		expect(Array.isArray(plugins)).toBe(true);
		expect(plugins?.[0]?.name).toBe("tailwind-atomic-css");
	});

	it("forwards factory options to the Vite adapter", () => {
		const integration = astro({cssEntries: ["src/styles/global.css"]});
		integration.hooks["astro:config:setup"]({updateConfig() {}});
		expect(ATOMIC_RUNTIME.cssEntries).toContain("src/styles/global.css");
	});
});

describe("factory astro transforms", () => {
	beforeEach(() => {
		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";
		ATOMIC_RUNTIME.classMap["p-6"] = "_bbbbbb";
	});

	it("includes .astro ids (template, script and style queries)", () => {
		const plugin = createPlugin();
		expect(plugin.transformInclude("src/pages/index.astro")).toBe(true);
		expect(
			plugin.transformInclude(
				"src/pages/index.astro?astro&type=script&index=0&lang.ts",
			),
		).toBe(true);
		expect(
			plugin.transformInclude(
				"src/pages/index.astro?astro&type=style&index=0&lang.css",
			),
		).toBe(true);
	});

	it("rewrites class attributes inside compiled renderTemplate output", async () => {
		const plugin = createPlugin();
		const compiled = `
			import { renderTemplate } from "astro/runtime/server/index.js";
			const $$Index = () => renderTemplate\`<div class="flex p-6">Hola</div>\`;
			export default $$Index;
		`;
		const result = await plugin.transform(compiled, "src/pages/index.astro");
		expect(result?.code).toContain('class="_aaaaaa _bbbbbb"');
		expect(result?.code).not.toContain('class="flex p-6"');
	});

	it("rewrites cn() in extracted client scripts", async () => {
		const plugin = createPlugin();
		const result = await plugin.transform(
			`import { cn } from "../lib/cn";\ncn("flex p-6");\n`,
			"src/components/Chip.astro?astro&type=script&index=0&lang.ts",
		);
		expect(result?.code).toContain("_aaaaaa");
		expect(result?.code).toContain("_bbbbbb");
		expect(result?.code).not.toContain("flex p-6");
	});

	it("atomicizes <style> submodules", async () => {
		const plugin = createPlugin();
		const result = await plugin.transform(
			".flex { display: flex }",
			"src/pages/index.astro?astro&type=style&index=0&lang.css",
		);
		expect(result?.code).toContain("/*! tailwind-atomic */");
		expect(result?.code).toMatch(/\._[0-9a-f]{6}/);
	});

	it("skips Vite HMR wrappers on astro styles", async () => {
		const plugin = createPlugin();
		expect(
			await plugin.transform(
				"import.meta.hot; .flex { display: flex }",
				"src/pages/index.astro?astro&type=style&index=0&lang.css",
			),
		).toBeNull();
	});

	it("still rewrites HTML class on node_modules .astro but skips cn()", async () => {
		const plugin = createPlugin();
		const source = `
			cn("flex");
			export const html = renderTemplate\`<div class="flex p-6"></div>\`;
		`;
		const result = await plugin.transform(
			source,
			"node_modules/ui-kit/Button.astro",
		);
		expect(result?.code).toContain('class="_aaaaaa _bbbbbb"');
		expect(result?.code).toContain('cn("flex")');
	});
});

describe("transformViteCss astro styles", () => {
	it("atomicizes Astro type=style modules", async () => {
		ATOMIC_RUNTIME.classMap = Object.create(null);
		const result = await transformViteCss(
			".flex { display: flex }",
			"src/pages/index.astro?astro&type=style&index=0&lang.css",
		);
		expect(result?.code).toContain("/*! tailwind-atomic */");
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);
	});
});
