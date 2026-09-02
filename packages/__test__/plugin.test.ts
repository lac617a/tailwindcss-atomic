import unplugin from "../core/plugin";
import {factory, unplugin as named} from "../core";
import index from "../index";
import vite from "../vite";
import webpack from "../webpack";
import rollup from "../rollup";
import esbuild from "../esbuild";

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
	});
});
