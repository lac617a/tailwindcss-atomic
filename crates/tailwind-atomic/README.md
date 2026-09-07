# tailwind-atomic

Rust compiler that turns compiled Tailwind CSS into atomic hashed classes.

This crate is the engine behind [`tailwindcss-atomic`](https://www.npmjs.com/package/tailwindcss-atomic). It has no JavaScript or `wasm-bindgen` dependency: use it from a CLI, a native plugin, or wrap it in WASM yourself.

## Usage

```rust
use tailwind_atomic::{atomicize_stylesheet, rewrite_class_string, rewrite_html_classes};

let out = atomicize_stylesheet(".flex { display: flex } .p-4 { padding: 1rem }")?;

// "flex" -> "_a1b2c3"
let classes = rewrite_class_string("flex p-4", &out.class_map);
let html = rewrite_html_classes(r#"<div class="flex p-4">"#, &out.class_map);
```

`atomicize_stylesheet` returns:

- `class_map` — original utility → space-separated atomic hashes
- `css` — full stylesheet with utilities replaced (keeps `@theme`, `:root`, `@media`, `@supports`, custom components)
- `css_rules` — only the hashed atomic rules
- `changed` — whether anything was rewritten

Custom classes that are not Tailwind-shaped (`.header-signin`, `.btn-notch`) and component `::before` / `::after` rules are left intact. `looks_like_tailwind_utility` is the classifier the JS plugin uses so it does not keep a second copy of Tailwind prefixes.

## WASM / bundlers

The npm package `tailwindcss-atomic` ships WebAssembly bindings from the `tailwind-atomic-wasm` crate in this repo. You do not need this crate unless you are embedding the compiler in Rust.

## License

MIT
