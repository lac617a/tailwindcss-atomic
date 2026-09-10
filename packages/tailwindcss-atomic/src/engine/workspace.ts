import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {dirname, join, parse} from "node:path";

function findMonorepoRoot(startDir = process.cwd()) {
	let dir = startDir;
	const {root} = parse(dir);
	while (true) {
		if (
			existsSync(join(dir, "pnpm-workspace.yaml")) ||
			existsSync(join(dir, "turbo.json")) ||
			existsSync(join(dir, "lerna.json")) ||
			existsSync(join(dir, "nx.json"))
		) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir || dir === root) return startDir;
		dir = parent;
	}
}

function readPackageName(dir: string) {
	try {
		const raw = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
			name?: unknown;
		};
		return typeof raw.name === "string" && raw.name ? raw.name : undefined;
	} catch {
		return undefined;
	}
}

function listAppDependencyNames(appDir: string) {
	const names = new Set<string>();
	try {
		const raw = JSON.parse(
			readFileSync(join(appDir, "package.json"), "utf8"),
		) as Record<string, unknown>;
		for (const field of [
			"dependencies",
			"devDependencies",
			"optionalDependencies",
			"peerDependencies",
		]) {
			const deps = raw[field];
			if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
			for (const name of Object.keys(deps)) names.add(name);
		}
	} catch {
		// Standalone apps without a readable package.json are fine.
	}
	return names;
}

/**
 * Names of workspace packages (ui-latamwin, @webs/latamwin, …).
 * Used as transpilePackages so Turbopack/Webpack rewrite design-system JS.
 */
function discoverWorkspacePackageNames(root: string) {
	const names: string[] = [];
	const seen = new Set<string>();

	function add(dir: string) {
		const name = readPackageName(dir);
		if (!name || seen.has(name)) return;
		seen.add(name);
		names.push(name);
	}

	function walk(dir: string, depth: number) {
		if (depth > 3) return;
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const name of entries) {
			if (name === "node_modules" || name.startsWith(".")) continue;
			const full = join(dir, name);
			try {
				if (!statSync(full).isDirectory()) continue;
			} catch {
				continue;
			}
			if (existsSync(join(full, "package.json"))) add(full);
			walk(full, depth + 1);
		}
	}

	for (const top of ["packages", "package", "apps"]) {
		const dir = join(root, top);
		if (existsSync(dir)) walk(dir, 0);
	}

	return names;
}

export {
	findMonorepoRoot,
	discoverWorkspacePackageNames,
	listAppDependencyNames,
	readPackageName,
};
