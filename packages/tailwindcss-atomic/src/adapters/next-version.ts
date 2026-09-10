import {createRequire} from "node:module";
import {join} from "node:path";

function readInstalledNextVersion(cwd = process.cwd()): string | undefined {
	try {
		const appRequire = createRequire(join(cwd, "package.json"));
		const pkg = appRequire("next/package.json") as {version?: unknown};
		return typeof pkg.version === "string" ? pkg.version : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Next 15.2 (and earlier) only understands nested `foreign` / `default` keys
 * on `turbopack.rules`. Next 15.5+ and Next 16+ use `condition` instead;
 * Next 16.3 rejects the old shorthand as unrecognized keys.
 */
function useLegacyTurboRuleShorthand(version?: string): boolean {
	if (!version) return false;
	const match = /^(\d+)\.(\d+)/.exec(version);
	if (!match?.[1] || !match[2]) return false;
	const major = Number(match[1]);
	const minor = Number(match[2]);
	if (major >= 16) return false;
	if (major === 15 && minor >= 5) return false;
	return true;
}

export {readInstalledNextVersion, useLegacyTurboRuleShorthand};
