# Ejemplo Next.js

App Router (Next 15) para probar **tailwindcss-atomic** en local.

## Arranque

Desde la raíz del monorepo (hace falta haber compilado el paquete):

```bash
pnpm build
pnpm dev
```

Queda en [http://localhost:3016](http://localhost:3016).

Solo esta app:

```bash
pnpm --filter next-app dev
```

## Qué mirar

1. Inspecciona el DOM: `className` no debería mostrar `flex` ni `bg-zinc-950`, sino hashes `_` + 6 hex.
2. El CSS compilado lleva el comentario `/*! tailwind-atomic */` y reglas `._aa7b5f { … }`.
3. El chip con `cn()` también se reescribe (incluye el estado activo/inactivo).

La config relevante:

- `next.config.ts` — `withTailwindAtomic`
- `postcss.config.mjs` — `@tailwindcss/postcss` y después `tailwindcss-atomic/postcss`
- `app/globals.css` — `@import "tailwindcss"`
