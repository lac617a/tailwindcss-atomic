import {ATOMIC_RUNTIME} from "./constants";
import {transformClassString} from "./css";

function cleanModuleId(id: string) {
	return id.split("?")[0]?.replace(/\\/g, "/") ?? "";
}

function isHtmlFile(id: string) {
	const cleanId = cleanModuleId(id);
	if (!cleanId) return false;
	return /\.html?$/.test(cleanId);
}

function isAstroFile(id: string) {
	const cleanId = cleanModuleId(id);
	if (!cleanId) return false;
	return cleanId.endsWith(".astro");
}

/**
 * Astro Vite ids keep the `.astro` path and encode the sub-resource in the
 * query (`type=style` / `type=script`). The compiled page stays `type=template`.
 */
function astroResourceType(id: string): "style" | "script" | "template" {
	const query = id.includes("?") ? id.slice(id.indexOf("?") + 1) : "";
	if (/(?:^|&)type=style(?:&|$)/.test(query)) return "style";
	if (/(?:^|&)type=script(?:&|$)/.test(query)) return "script";
	return "template";
}

/**
 * Rewrite class / className attributes in HTML (Vite index.html, emitted
 * assets). Same idea as tailwindcss-mangle's htmlHandler, without a full parser.
 */
function transformHtml(html: string) {
	if (!html || Object.keys(ATOMIC_RUNTIME.classMap).length === 0) {
		return html;
	}

	return html.replace(
		/(?<![A-Za-z0-9_-])(class(?:Name)?)\s*=\s*(["'])([^"']*)\2/gi,
		(_match, attr: string, quote: string, value: string) => {
			return `${attr}=${quote}${transformClassString(value, ATOMIC_RUNTIME.classMap)}${quote}`;
		},
	);
}

export {isHtmlFile, isAstroFile, astroResourceType, transformHtml};
