# Ejemplo Vite + Tailwind CSS 4

Vite + React 18 + **Tailwind CSS 4** (`@import "tailwindcss"` + `@theme`). Puerto **3020**.

No hay `tailwind.config.js`: v4 se configura en CSS.

```bash
pnpm build
pnpm --filter vite-v4-app dev
```

O desde la raíz:

```bash
pnpm dev:vite4
```

## Qué mirar

1. Inspecciona el DOM: `className` no debería mostrar `flex` ni `bg-zinc-950`, sino hashes `_` + 6 hex.
2. El CSS compilado lleva `/*! tailwind-atomic */` y reglas `._aa7b5f { … }`.
3. El botón con `cn()` también se reescribe en activo/inactivo.

Config:

- `vite.config.ts` — `tailwindcss-atomic/vite` (reescribe JSX / `cn`)
- `postcss.config.mjs` — `@tailwindcss/postcss` y **después** `tailwindcss-atomic/postcss`
- `src/index.css` — `@import "tailwindcss"` y `@theme`
