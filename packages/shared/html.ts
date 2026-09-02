import {ATOMIC_RUNTIME} from "./constants";
import {transformClassString} from "./css";

function isHtmlFile(id: string) {
	const cleanId = id.split("?")[0]?.replace(/\\/g, "/");
	if (!cleanId) return false;
	return /\.html?$/.test(cleanId);
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

export {isHtmlFile, transformHtml};
