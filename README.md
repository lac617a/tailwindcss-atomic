# Tailwind Atomic

[![codecov](https://codecov.io/gh/lac617a/tailwindcss-atomic/branch/main/graph/badge.svg)](https://codecov.io/gh/lac617a/tailwindcss-atomic)
[![GitHub stars](https://img.shields.io/github/stars/lac617a/tailwindcss-atomic)](https://github.com/lac617a/tailwindcss-atomic/stargazers)
[![npm downloads](https://img.shields.io/npm/dm/tailwindcss-atomic.svg)](https://www.npmjs.com/package/tailwindcss-atomic)

Monorepo de **tailwindcss-atomic**: un plugin que parte el CSS de Tailwind en declaraciones atómicas y reescribe los `className` del código a hashes cortos (`_aa7b5f`).

El motor de hashing y atomicización vive en **Rust compilado a WebAssembly** (`src/`). El empaquetado JavaScript (PostCSS + unplugin) conecta ese motor con Vite, Webpack, Rollup, esbuild, Next.js y Astro.

## Qué hace

Tailwind emite reglas como:

```css
.flex {
	display: flex;
}
.p-6 {
	padding: 1.5rem;
}
```

Este proyecto las descompone en una clase por declaración y las deduplica. En el DOM, `className="flex p-6"` pasa a algo como `class="_215464 _69df78"`. El HTML pesa menos y las utilidades originales no quedan a la vista.

El prefijo `_` evita clases que empiecen por dígito (inválidas en CSS). El sufijo son 6 dígitos hex, ~16,7 millones de valores.

## Estructura

| Ruta | Contenido |
| --- | --- |
| `src/` | Crate Rust (`lightningcss` + `wasm-bindgen`): atomiciza CSS, reescribe class strings y HTML |
| `packages/` | Paquete npm `tailwindcss-atomic` |
| `app/next-app/` | Next.js 15 · App Router · Tailwind 4 |
| `app/vite-app/` | Vite · React 18 · Tailwind 3 |
| `app/next12-app/` | Next.js 12 · Pages Router · Tailwind 3 |
| `app/next-turbo-app/` | Next.js 15 · App Router · Turbopack |
| `app/vite-v4-app/` | Vite · React 18 · Tailwind 4 |
| `app/astro-app/` | Astro 5 · Tailwind 4 |
| `website/` | Docs (Nextra) · [atomic.profiya.com](https://atomic.profiya.com/) |

SCSS con `@use 'tailwindcss/base|components|utilities'` (Tailwind 3 + Next 15) está documentado en [`packages/README.md`](packages/README.md).

La guía de uso de la librería está en [`packages/README.md`](packages/README.md).

## Requisitos

- Node.js **≥ 22.18.0**
- [pnpm](https://pnpm.io/)
- Para compilar el WASM: Rust (`wasm32-unknown-unknown`) y [wasm-pack](https://rustwasm.github.io/wasm-pack/)

## Desarrollo

```bash
pnpm install
pnpm build          # WASM + JavaScript
pnpm test           # Vitest (packages/__test__)
pnpm test:rust      # cargo test (motor WASM)
pnpm test:coverage  # coverage lcov para Codecov
pnpm dev            # Next 15 · http://localhost:3016
pnpm dev:vite       # Vite · http://localhost:3017
pnpm dev:next12     # Next 12 · http://localhost:3018
pnpm dev:turbo      # Next 15 Turbopack · http://localhost:3019
pnpm dev:vite4      # Vite · Tailwind 4 · http://localhost:3020
pnpm dev:astro      # Astro 5 · http://localhost:3021
pnpm dev:website    # Docs Nextra · http://localhost:3022
pnpm dev:examples   # todos los ejemplos a la vez (Turborepo)
```

Scripts sueltos:

```bash
pnpm build:wasm     # wasm-pack → packages/pkg
pnpm build:js       # tsdown (ESM + CJS)
```

Tras cambiar `src/lib.rs` hay que volver a `pnpm build:wasm` y reiniciar el servidor de desarrollo: el módulo WASM se carga al arrancar el proceso.

## Licencia

[MIT](LICENSE)
