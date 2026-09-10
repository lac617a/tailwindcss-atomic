import unplugin from "../src/engine/plugin";
import {factory, unplugin as named} from "../src/engine";
import index from "../src/index";
import vite from "../src/adapters/vite";
import webpack from "../src/adapters/webpack";
import rollup from "../src/adapters/rollup";
import esbuild from "../src/adapters/esbuild";
import astro from "../src/adapters/astro";
import {transformViteCss} from "../src/adapters/vite-css";
import {ATOMIC_RUNTIME} from "../src/engine/constants";

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
		expect(plugins[0]?.name).toBe("tailwindcss-atomic-css");
		expect(plugins[0]?.enforce).toBe("pre");
		expect(typeof plugins[1]).toBe("object");
	});

	it("serves the virtual runtime module", () => {
		const plugin = factory() as {
			resolveId?: (id: string) => string | undefined;
			load?: (id: string) => string | undefined;
			loadInclude?: (id: string) => boolean;
		};
		expect(plugin.resolveId?.("tailwindcss-atomic/runtime")).toBe(
			"\0tailwindcss-atomic-runtime",
		);
		expect(plugin.resolveId?.("tailwindcss-atomic/runtime?v=1")).toBe(
			"\0tailwindcss-atomic-runtime",
		);
		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";
		const source = plugin.load?.("\0tailwindcss-atomic-runtime");
		expect(source).toContain("atomicReconcile");
		expect(source).toContain("_aaaaaa");
		expect(source).not.toContain('from "tailwind-merge"');

		const encoded = encodeURIComponent("\0tailwindcss-atomic-runtime");
		const webpackId = `/tmp/app/_virtual_${encoded}`;
		expect(plugin.loadInclude?.("\0tailwindcss-atomic-runtime")).toBe(true);
		expect(plugin.loadInclude?.(webpackId)).toBe(true);
		expect(plugin.loadInclude?.(`C:\\tmp\\app\\_virtual_${encoded}`)).toBe(
			true,
		);
		expect(plugin.load?.(`D:/app/_virtual_${encoded}`)).toContain(
			"atomicReconcile",
		);

		expect(plugin.loadInclude?.("messages/en.json")).toBe(false);
		expect(plugin.loadInclude?.("/app/messages/en.json")).toBe(false);
		expect(plugin.loadInclude?.("src/app.tsx")).toBe(false);
		expect(plugin.loadInclude?.("")).toBe(false);
		expect(plugin.loadInclude?.("node_modules/pkg/data.json")).toBe(false);
	});
});

describe("transformViteCss", () => {
	it("atomicizes compiled CSS and skips Vite JS wrappers", async () => {
		ATOMIC_RUNTIME.classMap = Object.create(null);
		const result = await transformViteCss(
			".flex { display: flex }",
			"src/index.css",
		);
		expect(result?.code).toContain("/*! tailwindcss-atomic */");
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
