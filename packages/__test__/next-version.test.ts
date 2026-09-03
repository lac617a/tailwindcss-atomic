import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	readInstalledNextVersion,
	useLegacyTurboRuleShorthand,
} from "../shared/next-version";

const fixtures: string[] = [];

function makeDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-next-version-"));
	fixtures.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of fixtures) {
		fs.rmSync(dir, {recursive: true, force: true});
	}
	fixtures.length = 0;
});

describe("useLegacyTurboRuleShorthand", () => {
	it("uses the Next 16 condition schema from 15.5 up, and the nested shorthand before that", () => {
		expect(useLegacyTurboRuleShorthand()).toBe(false);
		expect(useLegacyTurboRuleShorthand("16.3.0")).toBe(false);
		expect(useLegacyTurboRuleShorthand("16.0.0-canary.0")).toBe(false);
		expect(useLegacyTurboRuleShorthand("15.5.0")).toBe(false);
		expect(useLegacyTurboRuleShorthand("15.4.2")).toBe(true);
		expect(useLegacyTurboRuleShorthand("15.2.4")).toBe(true);
		expect(useLegacyTurboRuleShorthand("12.3.4")).toBe(true);
		expect(useLegacyTurboRuleShorthand("not-a-version")).toBe(false);
	});
});

describe("readInstalledNextVersion", () => {
	it("reads next/package.json from the app directory", () => {
		const dir = makeDir();
		fs.writeFileSync(
			path.join(dir, "package.json"),
			JSON.stringify({name: "app"}),
		);
		fs.mkdirSync(path.join(dir, "node_modules", "next"), {recursive: true});
		fs.writeFileSync(
			path.join(dir, "node_modules", "next", "package.json"),
			JSON.stringify({name: "next", version: "16.3.0"}),
		);
		expect(readInstalledNextVersion(dir)).toBe("16.3.0");
	});

	it("returns undefined when next cannot be resolved", () => {
		expect(readInstalledNextVersion("\0invalid")).toBeUndefined();
	});

	it("returns undefined when next/package.json has no version", () => {
		const dir = makeDir();
		fs.writeFileSync(
			path.join(dir, "package.json"),
			JSON.stringify({name: "app"}),
		);
		fs.mkdirSync(path.join(dir, "node_modules", "next"), {recursive: true});
		fs.writeFileSync(
			path.join(dir, "node_modules", "next", "package.json"),
			JSON.stringify({name: "next"}),
		);
		expect(readInstalledNextVersion(dir)).toBeUndefined();
	});
});
