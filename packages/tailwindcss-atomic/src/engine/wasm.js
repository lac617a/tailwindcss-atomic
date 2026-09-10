import {createRequire} from "node:module";
import {existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const req = createRequire(import.meta.url);

function resolveWasmJs() {
	const names = [
		"tailwindcss_atomic_wasm.js",
		"tailwind_atomic_wasm.js",
	];
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 6; i++) {
		for (const name of names) {
			const candidate = join(dir, "pkg", name);
			if (existsSync(candidate)) return candidate;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return req.resolve("../pkg/tailwindcss_atomic_wasm.js");
}

const wasm = req(resolveWasmJs());

const {
	process_tailwind_css,
	rewrite_class_string,
	rewrite_html_classes,
	looks_like_tailwind_utility,
} = wasm;

export {
	process_tailwind_css,
	rewrite_class_string,
	rewrite_html_classes,
	looks_like_tailwind_utility,
};
