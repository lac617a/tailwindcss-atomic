import {
	applyAtomicCss,
	compileCssEntryForAtomic,
	isCssFile,
	isViteCssJsWrapper,
	shouldIgnoreCss,
} from "./css";
import {TAILWIND_DIRECTIVE_RE} from "./constants";
import {invalidateJsModules} from "./js";

function hasTailwindDirectives(css: string) {
	return TAILWIND_DIRECTIVE_RE.test(css);
}

async function transformViteCss(code: string, id: string) {
	if (!code || !isCssFile(id) || shouldIgnoreCss(id)) return null;
	if (isViteCssJsWrapper(code)) return null;

	const cssPath = id.split("?")[0] ?? id;
	let css = code;
	if (hasTailwindDirectives(code)) {
		const compiled = await compileCssEntryForAtomic(cssPath, code);
		if (!compiled) return null;
		css = compiled;
	}

	const {code: next, changed, mapChanged} = applyAtomicCss(css, id);
	if (mapChanged) invalidateJsModules();
	if (!changed) return null;
	return {code: next, map: null};
}

/**
 * Corre en `enforce: "pre"` para ver el CSS compilado por `@tailwindcss/vite`
 * antes de que Vite lo envuelva en el injector HMR.
 */
function createViteCssAtomicPlugin() {
	return {
		name: "tailwind-atomic-css",
		enforce: "pre" as const,
		async transform(code: string, id: string) {
			return transformViteCss(code, id);
		},
	};
}

export {createViteCssAtomicPlugin, transformViteCss};
