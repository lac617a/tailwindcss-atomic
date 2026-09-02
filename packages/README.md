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

## Turborepo / monorepo (Next + Turbopack)

Un className mixto (`flex … hover:bg-revamp-… _cafc46 _ffc2a9`) significa que **el CSS sí se atomicizó** pero **parte del JS no se reescribió**. En Webpack el plugin recorre todos los chunks en `processAssets`. Turbopack no tiene ese paso: solo reescribe los módulos que pasan por el loader.

Eso pasa cuando el `cva()` / `cn()` vive en un design system fuera de la app (`packages/ui`, `node_modules/ui-latamwin`) y las reglas de Turbopack solo tocaban el código de `apps/webs/latamwin`.

`withTailwindAtomic` ahora:

1. Pone el loader en **`foreign` y `default`** para `*.ts(x)`, `*.js(x)`, `*.mjs` y `*.cjs` (el loader no-op en `react` / `next`; sí reescribe `transpilePackages` y junctions del workspace).
2. Fija `turbopack.root` y `outputFileTracingRoot` en la raíz del monorepo (`turbo.json` / `pnpm-workspace.yaml`) si no los definiste.
3. Añade a `transpilePackages` los paquetes del workspace que la app declara en `dependencies` (por ejemplo `ui-latamwin`).
4. Hace warmup de **todas** las entradas CSS que encuentre (no solo la primera). Puedes forzar la de la web:

```ts
// apps/webs/latamwin/next.config.ts
import {withTailwindAtomic} from "tailwindcss-atomic/next";

const nextConfig = {
	reactStrictMode: true,
	transpilePackages: ["ui-latamwin"], // opcional: se detecta si está en package.json
};

export default withTailwindAtomic(nextConfig, {
	cssEntries: ["scss/styles.scss"],
});
```

El `tailwind.config.js` compartido (`packages/config/tailwind-config`) no hay que duplicarlo: Tailwind ya lo resuelve vía PostCSS de la app. Lo que sí debe pasar por el loader es el **JS que emite classNames** (botones `cva`, `cn` del design system).

Si un paquete UI se publica como `dist/*.js` y no está en `transpilePackages`, sus strings `flex` / `bg-revamp-*` llegan intactos al DOM y se mezclan con los hashes de la app. Añádelo a `transpilePackages` o importa el source (`exports` → `src`).

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

## esbuild

```js
import {build} from "esbuild";
import tailwindAtomic from "tailwindcss-atomic/esbuild";

await build({
	entryPoints: ["src/main.ts"],
	bundle: true,
	outfile: "dist/index.js",
	plugins: [tailwindAtomic()],
});
```

## Opciones

```ts
type Options = {
	/** Funciones cuyos argumentos de string se reescriben. */
	targetFunctions?: Set<string>;
	/** CSS de Tailwind ya compilado, para precargar el mapa (poco habitual). */
	tailwindCss?: string;
	/** Paquetes bajo node_modules cuyo JS sí se reescribe (design systems). */
	transpilePackages?: string[];
	/** CSS extra que no se atomiciza (además de node_modules). */
	ignoreCss?: Array<string | RegExp>;
	/** Funciones cuyos strings se dejan intactos (por defecto `twIgnore`). */
	preserveFunctions?: Iterable<string>;
	/** Inventario JSON del mapa (como `.tw-patch` en tailwindcss-mangle). `false` lo desactiva. */
	classMapFile?: string | boolean;
	/** Entradas CSS/SCSS extra para el warmup (monorepos: `scss/styles.scss`). */
	cssEntries?: string[];
};
```

Por defecto `targetFunctions` es `cn`, `clsx`, `classnames` y `cva`. También se reescriben atributos JSX `className` / `class`, props `className`/`class` de `jsx` / `jsxs` / `jsxDEV`, y atributos `class` en HTML (`index.html`, assets emitidos).

Envuelve strings que no deban tocarse con `twIgnore("flex hidden")`.

El mapa `flex` → `_xxxxxx` se guarda en `node_modules/.cache/tailwindcss-atomic/class-map.json` para que el rewrite de JS/HTML no dependa de que PostCSS haya corrido antes (el mismo patrón de inventario que [tailwindcss-mangle](https://github.com/sonofmagic/tailwindcss-mangle)).

```ts
withTailwindAtomic(nextConfig, {
	targetFunctions: new Set(["cn", "clsx", "tw"]),
});
```

## Qué se conserva

El motor Rust (WASM) solo atomiciza reglas de utilidad. Se dejan intactos `@theme`, `:root`, preflight, `@keyframes` y at-rules anidadas (`@media`, `@supports`, `@container`).

A diferencia de un rename 1:1, cada declaración se vuelve su propia clase; el resto del selector se **conserva** (`._hash:hover`, combinadores de `space-y-*`, el `@media` de `sm:`). Así no se pierde hover ni breakpoints.

## Licencia

MIT. El texto completo está en el archivo `LICENSE` de este repositorio.
