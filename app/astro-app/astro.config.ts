import {defineConfig} from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import tailwindAtomic from "tailwindcss-atomic/astro";

export default defineConfig({
	server: {
		port: 3021,
		strictPort: true,
	},
	integrations: [tailwindAtomic()],
	vite: {
		plugins: [tailwindcss()],
	},
});
