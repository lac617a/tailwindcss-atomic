# tailwindcss-atomic

Plugin para **Tailwind CSS** que convierte cada declaración en una clase atómica (`_aa7b5f`) y reescribe los `className` del JavaScript/TypeScript para que coincidan.

Sirve con **PostCSS**, **Vite**, **Webpack**, **Rollup** y **Next.js**.

## Instalación

```bash
pnpm add -D tailwindcss-atomic
```

Peer: `postcss` ≥ 8. Node.js ≥ 22.18.0. Webpack ≥ 5 es opcional (solo si usas ese bundler). `sass` es peer opcional: hace falta para warmup de entradas `.scss` / `.sass` con `@use` locales.

## Cómo encaja en el pipeline

1. Tailwind (v3 o v4) expande `@tailwind` / `@import "tailwindcss"`.
2. El plugin de PostCSS **debe ir después** de Tailwind: lee esas reglas, las parte y arma el mapa `flex` → `_215464`.
3. El plugin del bundler (o el loader de Next) sustituye strings en JSX y en llamadas a `cn`, `clsx`, `classnames` y `cva`.

Sin el paso 2 el CSS no se atomiciza. Sin el paso 3 el DOM sigue con `flex` y `p-6`.

## PostCSS

Tailwind **v4**:

```js
// postcss.config.mjs
export default {
	plugins: {
		"@tailwindcss/postcss": {},
		"tailwindcss-atomic/postcss": {},
	},
};
```

Tailwind **v3** (Vite o Next 12): el plugin va **después** de `tailwindcss` y `autoprefixer`.

```js
// postcss.config.js
module.exports = {
	plugins: {
		tailwindcss: {},
		autoprefixer: {},
		"tailwindcss-atomic/postcss": {},
	},
};
```

## Next.js 15 (App Router, Tailwind 4)

```ts
// next.config.ts
import {withTailwindAtomic} from "tailwindcss-atomic/next";

const nextConfig = {reactStrictMode: true};

export default withTailwindAtomic(nextConfig);
```

Hay un ejemplo en `app/next-app` (`pnpm dev`, puerto 3016).

## Next.js 15 + Tailwind 3 + SCSS

Tailwind v3 no expande `@use 'tailwindcss/utilities'`; espera `@tailwind utilities`. Si la entrada es SCSS (por ejemplo `scss/styles.scss` importada desde `app/layout.tsx`) el warmup **normaliza** esas capas y, si está instalado `sass`, compila los `@use` locales antes de PostCSS. Así el mapa `flex` → `_xxxxxx` existe **antes** de que Webpack transforme los bundles de App Router (client, SSR y RSC).

```scss
// scss/styles.scss
@use 'tailwindcss/base';
@use 'tailwindcss/components';
@use 'tailwindcss/utilities';
@use './themes/brand' as themes;
```

```ts
// app/layout.tsx
import "../scss/styles.scss";
```

```js
// postcss.config.js — el plugin atomic va el último
module.exports = {
	plugins: {
		"postcss-import": {},
		"tailwindcss/nesting": {},
		tailwindcss: {},
		autoprefixer: {},
		"tailwindcss-atomic/postcss": {},
	},
};
```

```ts
// next.config.ts
import {withTailwindAtomic} from "tailwindcss-atomic/next";

export default withTailwindAtomic({reactStrictMode: true});
```

`withTailwindAtomic` inyecta el loader de Webpack (pre) y el plugin que, en `processAssets`, atomiciza **todo** el CSS y después reescribe **todo** el JS (incluidos chunks de servidor). En `next dev` invalida módulos JS cuando cambia el mapa.

El path clásico `app/globals.css` con `@tailwind base/components/utilities` sigue igual.

## Next.js 15 + Turbopack

```ts
// next.config.ts
import {withTailwindAtomic} from "tailwindcss-atomic/next";

export default withTailwindAtomic({
	reactStrictMode: true,
});
```

```json
{ "scripts": { "dev": "next dev --turbopack --port 3019" } }
```

`withTailwindAtomic` rellena `turbopack.rules` con el loader de TS/JS (además del hook de Webpack). El PostCSS de Tailwind 4 sigue siendo obligatorio. Ejemplo: `app/next-turbo-app` (`pnpm dev:turbo`).

## Next.js 12 (Pages Router, Tailwind 3)

```js
// next.config.mjs
import {withTailwindAtomic} from "tailwindcss-atomic/next";

export default withTailwindAtomic({
	reactStrictMode: true,
});
```

Usa `pages/`, `styles/globals.css` con `@tailwind base/components/utilities` y el PostCSS de v3 de arriba. Ejemplo: `app/next12-app` (`pnpm dev:next12`, puerto 3018).

## Vite (Tailwind 3)

```ts
import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import tailwindAtomic from "tailwindcss-atomic/vite";

export default defineConfig({
	plugins: [react(), tailwindAtomic()],
});
```

Ejemplo: `app/vite-app` (`pnpm dev:vite`, puerto 3017).

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
