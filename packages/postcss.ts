import postcss from "postcss";
import type {Root as PostcssRoot} from "postcss";

import {ATOMIC_RUNTIME} from "./shared/constants";
import type {IgnoreCssPattern, PreserveClassPattern} from "./shared/constants";
import {applyAtomicCss, shouldIgnoreCss} from "./shared/css";
import {invalidateJsModules} from "./shared/js";

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
export default function postcssTailwindAtomic(options: PostcssAtomicOptions = {}) {
	if (options.ignoreCss?.length) {
		ATOMIC_RUNTIME.ignoreCss.push(...options.ignoreCss);
	}
	if (options.preserveClasses?.length) {
		ATOMIC_RUNTIME.preserveClasses.push(...options.preserveClasses);
	}

	return {
		postcssPlugin: "postcss-tailwind-atomic",
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

postcssTailwindAtomic.postcss = true;
