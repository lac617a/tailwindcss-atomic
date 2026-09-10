#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const apps = [
	"next-app",
	"next-turbo-app",
	"next12-app",
	"vite-app",
	"vite-v4-app",
	"astro-app",
];

let failed = false;
for (const app of apps) {
	console.log(`\n=== ${app} ===\n`);
	const result = spawnSync(
		"pnpm",
		["--filter", app, "build"],
		{
			cwd: root,
			stdio: "inherit",
			shell: true,
			env: {
				...process.env,
				TAILWINDCSS_ATOMIC_REPORT: process.env.TAILWINDCSS_ATOMIC_REPORT || "1",
			},
		},
	);
	if (result.status !== 0) {
		failed = true;
		console.error(`[report:apps] ${app} failed`);
	}
}

process.exit(failed ? 1 : 0);
