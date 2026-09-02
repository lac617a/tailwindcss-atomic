import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import tailwindAtomic from "tailwindcss-atomic/vite";

export default defineConfig({
	plugins: [react(), tailwindAtomic()],
	server: {
		port: 3020,
		strictPort: true,
		warmup: {
			clientFiles: ["./src/index.css"],
		},
	},
});
