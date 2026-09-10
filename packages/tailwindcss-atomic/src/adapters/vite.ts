import {unplugin} from "../engine";
import {createViteCssAtomicPlugin} from "./vite-css";
import type {UnpluginFactoryOptions} from "../types";

export default function tailwindcssAtomicVite(options?: UnpluginFactoryOptions) {
	const jsPlugin = unplugin.vite(options);
	const cssPlugin = createViteCssAtomicPlugin();
	return Array.isArray(jsPlugin)
		? [cssPlugin, ...jsPlugin]
		: [cssPlugin, jsPlugin];
}
