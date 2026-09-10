import {defineConfig} from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import tailwindcssAtomic from "tailwindcss-atomic/astro";

export default defineConfig({
	server: {
		port: 3021,
		strictPort: true,
	},
	integrations: [tailwindcssAtomic()],
	vite: {
		plugins: [tailwindcss()],
	},
});
