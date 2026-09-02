import tailwindAtomicVite from "./vite";
import type {UnpluginFactoryOptions} from "./types";

type AstroConfigSetupCtx = {
	updateConfig: (config: {vite?: {plugins?: unknown}}) => void;
};

/**
 * Integración de Astro: inyecta el plugin de Vite (CSS pre + rewrite de JS/HTML).
 * Tailwind v4 sigue yendo aparte con `@tailwindcss/vite`.
 */
export default function tailwindAtomicAstro(
	options?: UnpluginFactoryOptions,
) {
	return {
		name: "tailwindcss-atomic",
		hooks: {
			"astro:config:setup"(ctx: AstroConfigSetupCtx) {
				ctx.updateConfig({
					vite: {
						plugins: tailwindAtomicVite(options),
					},
				});
			},
		},
	};
}
