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

## Publicar en https://atomic.profiya.com/

El sitio usa el middleware i18n de Nextra, así que **no** vale GitHub Pages ni `output: 'export'`. Hace falta un host que ejecute Next.js. Lo más simple es [Vercel](https://vercel.com) (gratis para un repo público).

1. Sube `main` a GitHub (`lac617a/tailwindcss-atomic`).
2. En Vercel: **Add New → Project** e importa ese repo.
3. Ajustes del proyecto:
   - **Framework Preset:** Next.js
   - **Root Directory:** `website` (botón *Edit* junto a Root Directory)
   - **Node.js:** 22
   - El `vercel.json` de esta carpeta ya pone `pnpm install` en la raíz del monorepo y `pnpm build` (así corre Pagefind).
4. Deploy. Comprueba la URL `*.vercel.app`.
5. **Settings → Domains → Add:** `atomic.profiya.com`.
6. En el DNS de `profiya.com` (Cloudflare, Namecheap, etc.) crea:

   | Tipo | Nombre | Destino |
   | --- | --- | --- |
   | `CNAME` | `atomic` | `cname.vercel-dns.com` |

   Si usas Cloudflare, deja el registro en **DNS only** (nube gris) para que Vercel emita el certificado SSL. En unos minutos el dashboard de Vercel marcará el dominio como válido.

Cada push a `main` que toque `website/` vuelve a desplegar.

Nextra 4.6.1 no se lleva bien con Zod ≥ 4.4 (el `<Layout>` explota con `expected nonoptional` en `children`). El monorepo fija `zod@4.3.6` en `pnpm.overrides` hasta que publiquen el parche.
