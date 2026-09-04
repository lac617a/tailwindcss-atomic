# Website

Documentación de **tailwindcss-atomic**, basada en [Nextra](https://nextra.site).

Inglés en `/en`, español en `/es`. El dominio previsto es [atomic.profiya.com](https://atomic.profiya.com/).

## Arranque

Desde la raíz del monorepo:

```bash
pnpm install
pnpm dev:website
```

Queda en [http://localhost:3022](http://localhost:3022).

## Build

```bash
pnpm --filter website build
pnpm --filter website start
```

El `postbuild` indexa la búsqueda con [Pagefind](https://pagefind.app/).

Nextra 4.6.1 no se lleva bien con Zod ≥ 4.4 (el `<Layout>` explota con `expected nonoptional` en `children`). El monorepo fija `zod@4.3.6` en `pnpm.overrides` hasta que publiquen el parche.
