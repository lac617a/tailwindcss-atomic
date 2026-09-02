import unplugin from "../core/plugin";
import {factory, unplugin as named} from "../core";
import index from "../index";
import vite from "../vite";
import webpack from "../webpack";
import rollup from "../rollup";
import esbuild from "../esbuild";
import astro from "../astro";
import {transformViteCss} from "../shared/vite-css";
import {ATOMIC_RUNTIME} from "../shared/constants";

describe("plugin adapters", () => {
	it("creates an unplugin instance from the factory", () => {
		expect(unplugin).toBe(named);
		expect(index).toBe(unplugin);
		expect(typeof factory).toBe("function");
		expect(typeof unplugin.vite).toBe("function");
		expect(typeof unplugin.webpack).toBe("function");
		expect(typeof unplugin.esbuild).toBe("function");
	});

	it("re-exports bundler entry points", () => {
		expect(typeof vite).toBe("function");
		expect(typeof webpack).toBe("function");
		expect(typeof rollup).toBe("function");
		expect(typeof esbuild).toBe("function");
		expect(typeof astro).toBe("function");
	});

	it("returns a CSS pre-plugin plus the unplugin Vite adapter", () => {
		const plugins = vite();
		expect(Array.isArray(plugins)).toBe(true);
		expect(plugins[0]?.name).toBe("tailwind-atomic-css");
		expect(plugins[0]?.enforce).toBe("pre");
		expect(typeof plugins[1]).toBe("object");
	});

	it("serves the virtual runtime module", () => {
		const plugin = factory() as {
			resolveId?: (id: string) => string | undefined;
			load?: (id: string) => string | undefined;
		};
		expect(plugin.resolveId?.("virtual:tailwind-atomic/runtime")).toBe(
			"\0tailwind-atomic-runtime",
		);
		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";
		const source = plugin.load?.("\0tailwind-atomic-runtime");
		expect(source).toContain("atomicReconcile");
		expect(source).toContain("_aaaaaa");
		expect(source).not.toContain('from "tailwind-merge"');
	});
});

describe("transformViteCss", () => {
	it("atomicizes compiled CSS and skips Vite JS wrappers", async () => {
		ATOMIC_RUNTIME.classMap = Object.create(null);
		const result = await transformViteCss(
			".flex { display: flex }",
			"src/index.css",
		);
		expect(result?.code).toContain("/*! tailwind-atomic */");
		expect(ATOMIC_RUNTIME.classMap["flex"]).toMatch(/^_[0-9a-f]{6}$/);

		expect(
			await transformViteCss("import.meta.hot.accept()", "src/index.css"),
		).toBeNull();
		expect(await transformViteCss("", "src/index.css")).toBeNull();
		expect(
			await transformViteCss(".flex { display: flex }", "Button.module.css"),
		).toBeNull();
	});
});
