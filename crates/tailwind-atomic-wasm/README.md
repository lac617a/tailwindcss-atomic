# tailwind-atomic-wasm

`wasm-bindgen` glue around [`tailwind-atomic`](../tailwind-atomic). Not published to crates.io.

Build the npm artifact:

```bash
pnpm build:wasm
```

That writes `packages/tailwindcss-atomic/pkg/` (`tailwind_atomic_wasm.js` + `.wasm`) for `tailwindcss-atomic`.
