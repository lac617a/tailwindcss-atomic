import postcss from "postcss";
import type {Root as PostcssRoot} from "postcss";

import {ATOMIC_RUNTIME} from "../engine/constants";
import type {IgnoreCssPattern, PreserveClassPattern} from "../engine/constants";
import {applyAtomicCss, shouldIgnoreCss} from "../engine/css";
import {invalidateJsModules} from "../engine/js";

type PostcssAtomicOptions = {
	ignoreCss?: IgnoreCssPattern[];
	preserveClasses?: PreserveClassPattern[];
};

/**
 * PostCSS plugin: va DESPUÉS de Tailwind.
 * Tailwind expande @tailwind/@import; este plugin lee esas reglas
 * y las parte en clases atómicas `_xxxxxx`.
 * CSS de `node_modules` (slick, etc.) se deja intacto.
 */
export default function postcssTailwindcssAtomic(options: PostcssAtomicOptions = {}) {
	if (options.ignoreCss?.length) {
		ATOMIC_RUNTIME.ignoreCss.push(...options.ignoreCss);
	}
	if (options.preserveClasses?.length) {
		ATOMIC_RUNTIME.preserveClasses.push(...options.preserveClasses);
	}

	return {
		postcssPlugin: "postcss-tailwindcss-atomic",
		Once(root: PostcssRoot) {
			const from = root.source?.input?.from;
			if (shouldIgnoreCss(from)) return;

			const css = root.toString();
			const {code, changed, mapChanged} = applyAtomicCss(css, from);
			if (!changed) return;

			if (mapChanged) invalidateJsModules();

			const parsed = postcss.parse(code, {
				from,
			});

			root.removeAll();
			root.append(parsed.nodes);
		},
	};
}

postcssTailwindcssAtomic.postcss = true;
