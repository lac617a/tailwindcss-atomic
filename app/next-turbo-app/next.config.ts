import path from "node:path";
import {fileURLToPath} from "node:url";
import type {NextConfig} from "next";
import {withTailwindAtomic} from "tailwindcss-atomic/next";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");

const nextConfig: NextConfig = {
	reactStrictMode: true,
	outputFileTracingRoot: repoRoot,
	turbopack: {
		// pnpm guarda `next` en el store del monorepo; Turbopack tiene que
		// ver esa ruta o falla con "Next.js package not found".
		root: repoRoot,
	},
};

export default withTailwindAtomic(nextConfig);
