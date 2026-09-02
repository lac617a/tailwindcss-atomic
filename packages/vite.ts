import {unplugin} from "./core";
import {createViteCssAtomicPlugin} from "./shared/vite-css";
import type {UnpluginFactoryOptions} from "./types";

export default function tailwindAtomicVite(options?: UnpluginFactoryOptions) {
	const jsPlugin = unplugin.vite(options);
	const cssPlugin = createViteCssAtomicPlugin();
	return Array.isArray(jsPlugin)
		? [cssPlugin, ...jsPlugin]
		: [cssPlugin, jsPlugin];
}
