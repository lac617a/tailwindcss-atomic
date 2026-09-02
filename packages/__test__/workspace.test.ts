import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	discoverWorkspacePackageNames,
	findMonorepoRoot,
	listAppDependencyNames,
	readPackageName,
} from "../shared/workspace";

const fixtures: string[] = [];

function makeDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-workspace-"));
	fixtures.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of fixtures) {
		fs.rmSync(dir, {recursive: true, force: true});
	}
	fixtures.length = 0;
});

describe("workspace discovery", () => {
	it("finds the monorepo root from turbo.json or pnpm-workspace.yaml", () => {
		const root = makeDir();
		const app = path.join(root, "apps", "web");
		fs.mkdirSync(app, {recursive: true});
		fs.writeFileSync(path.join(root, "turbo.json"), "{}");
		expect(findMonorepoRoot(app)).toBe(root);

		const pnpmRoot = makeDir();
		const nested = path.join(pnpmRoot, "apps", "web");
		fs.mkdirSync(nested, {recursive: true});
		fs.writeFileSync(path.join(pnpmRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
		expect(findMonorepoRoot(nested)).toBe(pnpmRoot);
	});

	it("returns the start dir when no workspace markers exist", () => {
		const dir = makeDir();
		expect(findMonorepoRoot(dir)).toBe(dir);
	});

	it("lists workspace package names under packages/ and apps/", () => {
		const root = makeDir();
		const ui = path.join(root, "packages", "ui", "ui-latamwin");
		const app = path.join(root, "apps", "webs", "latamwin");
		fs.mkdirSync(ui, {recursive: true});
		fs.mkdirSync(app, {recursive: true});
		fs.writeFileSync(
			path.join(ui, "package.json"),
			JSON.stringify({name: "ui-latamwin"}),
		);
		fs.writeFileSync(
			path.join(app, "package.json"),
			JSON.stringify({name: "@webs/latamwin"}),
		);
		fs.mkdirSync(path.join(root, "packages", "ui", "node_modules"), {
			recursive: true,
		});

		const names = discoverWorkspacePackageNames(root);
		expect(names).toContain("ui-latamwin");
		expect(names).toContain("@webs/latamwin");
	});

	it("reads app dependency names used to auto-transpile workspace UI", () => {
		const app = makeDir();
		fs.writeFileSync(
			path.join(app, "package.json"),
			JSON.stringify({
				name: "@webs/latamwin",
				dependencies: {"ui-latamwin": "workspace:*"},
				devDependencies: {"tailwindcss-atomic": "1.0.0"},
			}),
		);
		expect(readPackageName(app)).toBe("@webs/latamwin");
		expect(listAppDependencyNames(app)).toEqual(
			new Set(["ui-latamwin", "tailwindcss-atomic"]),
		);
		expect(listAppDependencyNames(path.join(app, "missing"))).toEqual(
			new Set(),
		);
	});
});
