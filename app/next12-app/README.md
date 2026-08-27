# Ejemplo Next.js 12

Pages Router + **Tailwind CSS 3** + Webpack. Puerto **3018**.

```bash
pnpm build
pnpm --filter next12-app dev
```

Con Turbo:

```bash
pnpm turbo dev --filter=next12-app
```

Config:

- `next.config.mjs` — `withTailwindAtomic` (no App Router; Next 12 no tiene Turbopack)
- `postcss.config.js` — `tailwindcss`, `autoprefixer`, `tailwindcss-atomic/postcss`
- `styles/globals.css` — `@tailwind base/components/utilities`

El plugin de Next usa Webpack. `next dev --turbo` (Turbopack, Next 13+) no aplica este wrapper.
