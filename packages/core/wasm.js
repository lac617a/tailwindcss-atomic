import {createRequire} from "node:module";

const req = createRequire(import.meta.url);
const wasmPath = req.resolve("../pkg/tailwind_atomic_wasm.js");
const wasm = req(wasmPath);

const {
	process_tailwind_css,
	rewrite_class_string,
	rewrite_html_classes,
} = wasm;

export {process_tailwind_css, rewrite_class_string, rewrite_html_classes};
