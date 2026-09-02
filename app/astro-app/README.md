# Ejemplo Astro + Tailwind CSS 4

Astro 5 + **Tailwind CSS 4** (`@tailwindcss/vite` + `@import "tailwindcss"`). Puerto **3021**.

```bash
pnpm build
pnpm --filter astro-app dev
```

O desde la raíz:

```bash
pnpm dev:astro
```

## Qué mirar

1. Inspecciona el DOM: `class` no debería mostrar `flex` ni `bg-zinc-950`, sino hashes `_` + 6 hex.
2. El CSS compilado lleva `/*! tailwind-atomic */` y reglas `._aa7b5f { … }`.
3. El botón con `cn()` también se reescribe en activo/inactivo.

Config:

- `astro.config.ts` — `tailwindcss-atomic/astro` (inyecta el plugin de Vite) y `@tailwindcss/vite`
- `src/styles/global.css` — `@import "tailwindcss"` y `@theme`
- No hace falta `postcss.config`
