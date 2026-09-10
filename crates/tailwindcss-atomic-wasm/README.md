# tailwindcss-atomic-wasm

`wasm-bindgen` glue around [`tailwindcss-atomic`](../tailwindcss-atomic). Not published to crates.io.

Build the npm artifact:

```bash
pnpm build:wasm
```

That writes `packages/tailwindcss-atomic/pkg/` (`tailwindcss_atomic_wasm.js` + `.wasm`) for the npm package.
