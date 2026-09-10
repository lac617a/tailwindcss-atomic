import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcssAtomic from "tailwindcss-atomic/vite";

export default defineConfig({
	plugins: [react(), tailwindcssAtomic()],
	server: {
		port: 3020,
		strictPort: true,
		warmup: {
			clientFiles: ["./src/index.css"],
		},
	},
});
