# Ejemplo Vite

Vite + React 18 + **Tailwind CSS 3**. Puerto **3017**.

```bash
pnpm build
pnpm --filter vite-app dev
```

O con Turbo, desde la raíz:

```bash
pnpm turbo dev --filter=vite-app
```

Config:

- `vite.config.ts` — `tailwindcss-atomic/vite`
- `postcss.config.js` — `tailwindcss`, `autoprefixer`, luego `tailwindcss-atomic/postcss`
- `src/index.css` — `@tailwind base/components/utilities`
