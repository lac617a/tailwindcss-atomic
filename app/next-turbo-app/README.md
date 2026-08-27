# Ejemplo Next.js + Turbopack

App Router (Next 15) con **`next dev --turbopack`**. Puerto **3019**.

```bash
pnpm build
pnpm --filter next-turbo-app dev
```

Desde la raíz:

```bash
pnpm dev:turbo
```

`withTailwindAtomic` configura:

- **Webpack** (`webpack()`, por si corres `next dev` sin flag)
- **Turbopack** (`turbopack.rules` con el loader en `*.tsx` / `*.ts` / `*.jsx`, sin tocar `node_modules`)
- **PostCSS** — sigue haciendo falta `tailwindcss-atomic/postcss` después de Tailwind

En un monorepo pnpm hay que fijar `turbopack.root` (y `outputFileTracingRoot`) a la raíz del workspace. Si no, Turbopack no resuelve el paquete `next` y peta con `Next.js package not found`.

No confundir con **Turborepo** (`turbo run dev` en la raíz del monorepo), que orquesta varios ejemplos a la vez.
