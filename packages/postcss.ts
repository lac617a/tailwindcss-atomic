import postcss from "postcss";
import type {Root as PostcssRoot} from "postcss";

import {applyAtomicCss} from "./shared/css";
import {invalidateJsModules} from "./shared/js";

/**
 * PostCSS plugin: va DESPUÉS de Tailwind.
 * Tailwind expande @tailwind/@import; este plugin lee esas reglas
 * y las parte en clases atómicas `_twa(hex)`.
 */
export function postcssTailwindAtomic() {
	return {
		postcssPlugin: "postcss-tailwind-atomic",
		Once(root: PostcssRoot) {
			const css = root.toString();
			const {code, changed, mapChanged} = applyAtomicCss(css);
			if (!changed) return;

			if (mapChanged) invalidateJsModules();

			const parsed = postcss.parse(code, {
				from: root.source?.input?.from,
			});

			root.removeAll();
			root.append(parsed.nodes);
		},
	};
}

postcssTailwindAtomic.postcss = true;

export default postcssTailwindAtomic;
