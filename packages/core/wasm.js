import {createRequire} from "node:module";

const req = createRequire(import.meta.url);
const wasmPath = req.resolve("../pkg/tailwind_atomic_wasm.js");
const {process_tailwind_css} = req(wasmPath);

export {process_tailwind_css};
