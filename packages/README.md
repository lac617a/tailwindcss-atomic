# tailwindcss-atomic

Plugin para **Tailwind CSS** que convierte cada declaración en una clase atómica (`_aa7b5f`) y reescribe los `className` del JavaScript/TypeScript para que coincidan.

Sirve con **PostCSS**, **Vite**, **Webpack**, **Rollup** y **Next.js**.

## Instalación

```bash
pnpm add -D tailwindcss-atomic
```

Peer: `postcss` ≥ 8. Node.js ≥ 22.18.0. Webpack ≥ 5 es opcional (solo si usas ese bundler).

## Cómo encaja en el pipeline

1. Tailwind (v3 o v4) expande `@tailwind` / `@import "tailwindcss"`.
2. El plugin de PostCSS **debe ir después** de Tailwind: lee esas reglas, las parte y arma el mapa `flex` → `_215464`.
3. El plugin del bundler (o el loader de Next) sustituye strings en JSX y en llamadas a `cn`, `clsx`, `classnames` y `cva`.

Sin el paso 2 el CSS no se atomiciza. Sin el paso 3 el DOM sigue con `flex` y `p-6`.

## PostCSS

```js
// postcss.config.mjs
export default {
	plugins: {
		"@tailwindcss/postcss": {}, // o "tailwindcss" en v3
		"tailwindcss-atomic/postcss": {},
	},
};
```

## Next.js

```ts
// next.config.ts
import {withTailwindAtomic} from "tailwindcss-atomic/next";

const nextConfig = {reactStrictMode: true};

export default withTailwindAtomic(nextConfig);
```

Añade también el plugin de PostCSS como arriba. `withTailwindAtomic` envuelve Webpack (loader + plugin) y respeta un `webpack()` que ya tengas en la config.

## Vite

```ts
import {defineConfig} from "vite";
import tailwindAtomic from "tailwindcss-atomic/vite";

export default defineConfig({
	plugins: [tailwindAtomic()],
});
```

## Webpack

```js
const tailwindAtomic = require("tailwindcss-atomic/webpack");

module.exports = {
	plugins: [tailwindAtomic()],
};
```

## Rollup

```js
import tailwindAtomic from "tailwindcss-atomic/rollup";

export default {
	plugins: [tailwindAtomic()],
};
```

## Opciones

```ts
type Options = {
	/** Funciones cuyos argumentos de string se reescriben. */
	targetFunctions?: Set<string>;
	/** CSS de Tailwind ya compilado, para precargar el mapa (poco habitual). */
	tailwindCss?: string;
};
```

Por defecto `targetFunctions` es `cn`, `clsx`, `classnames` y `cva`. También se reescriben atributos JSX `className` y props `className`/`class` de `jsx` / `jsxs` / `jsxDEV`.

```ts
withTailwindAtomic(nextConfig, {
	targetFunctions: new Set(["cn", "clsx", "tw"]),
});
```

## Qué se conserva

El WASM solo toca reglas de utilidad (selectores con `.`). Se dejan intactos `@theme`, `:root`, preflight, `@keyframes` y at-rules anidadas (`@media`, `@supports`, `@container`) en el sentido de que el contenedor se recorre y las utilidades de dentro sí se atomicizan.

## Licencia

MIT. El texto completo está en el archivo `LICENSE` de este repositorio.
