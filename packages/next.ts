import {createRequire} from "node:module";
import type {Configuration} from "webpack";

import webpackTailwindAtomic from "./webpack";
import {ATOMIC_RUNTIME} from "./shared/constants";
import {shouldSkipJsTransform} from "./shared/js";
import {
	discoverWorkspacePackageNames,
	findMonorepoRoot,
	listAppDependencyNames,
	readPackageName,
} from "./shared/workspace";

const req = createRequire(import.meta.url);

type NextWebpackOptions = {
	dev: boolean;
	[key: string]: unknown;
};

type TurboRuleOptions = {
	loaders: string[];
	as?: string;
};

/** Next 15: `foreign` = node_modules / files outside the app dir. */
type TurboRule =
	| TurboRuleOptions
	| {
			foreign?: TurboRule | false;
			default?: TurboRule | false;
	  };

/** Accepts Next.js `NextConfig` (`webpack` may be a hook, `null`, or omitted). */
type NextConfigInput = {
	webpack?: ((...args: never[]) => unknown) | null;
	transpilePackages?: string[];
	outputFileTracingRoot?: string;
	turbopack?: {
		root?: string;
		rules?: Record<string, unknown>;
		[key: string]: unknown;
	};
};

type AtomicNextConfig<T> = Omit<
	T,
	"webpack" | "turbopack" | "transpilePackages" | "outputFileTracingRoot"
> & {
	transpilePackages: string[];
	outputFileTracingRoot?: string;
	turbopack: {
		root: string;
		rules: Record<string, TurboRule | TurboRule[]>;
		[key: string]: unknown;
	};
	webpack: (
		config: Configuration,
		options: NextWebpackOptions,
	) => Configuration;
};

type AtomicNextOptions = Parameters<typeof webpackTailwindAtomic>[0] & {
	cssEntries?: string[];
};

function resolveAtomicLoader() {
	try {
		return req.resolve("./loader.cjs");
	} catch {
		return req.resolve("../dist/loader.cjs");
	}
}

function turboLoaderRules(atomicLoader: string): Record<string, TurboRule> {
	// `as: '*'` keeps the original name. `as: '*.tsx'` on a `.tsx` file becomes
	// `file.tsx.tsx` because `*` is the full filename.
	//
	// `foreign` MUST also run the loader: in a Turborepo the design system lives
	// in packages/ui (outside the Next app dir) or in node_modules/.pnpm dist.
	// Webpack already rewrites those via transpilePackages; Turbopack skipped
	// them, which left mixed classNames (`flex … _cafc46`).
	const withLoader: TurboRuleOptions = {
		loaders: [atomicLoader],
		as: "*",
	};
	const appAndWorkspace: TurboRule = {
		foreign: withLoader,
		default: withLoader,
	};

	return {
		"*.tsx": appAndWorkspace,
		"*.ts": appAndWorkspace,
		"*.jsx": appAndWorkspace,
		"*.js": appAndWorkspace,
		"*.mjs": appAndWorkspace,
		"*.cjs": appAndWorkspace,
	};
}

function collectTranspilePackages(
	nextConfig: NextConfigInput,
	options: AtomicNextOptions,
) {
	const names = new Set<string>([
		...(options?.transpilePackages ?? []),
		...(nextConfig.transpilePackages ?? []),
	]);
	try {
		const appDir = process.cwd();
		const root = findMonorepoRoot(appDir);
		const appDeps = listAppDependencyNames(appDir);
		const selfName = readPackageName(appDir);
		for (const name of discoverWorkspacePackageNames(root)) {
			if (name === selfName) continue;
			if (appDeps.has(name)) names.add(name);
		}
	} catch {
		// Optional: a missing packages/ folder is fine for a standalone app.
	}
	return [...names];
}

type NextWebpackHook = (
	config: Configuration,
	options: NextWebpackOptions,
) => Configuration | null | undefined;

function callUserWebpack(
	webpackHook: unknown,
	config: Configuration,
	webpackOptions: NextWebpackOptions,
): Configuration {
	if (typeof webpackHook !== "function") {
		return config;
	}
	return (webpackHook as NextWebpackHook)(config, webpackOptions) ?? config;
}

export function withTailwindAtomic<T extends NextConfigInput = NextConfigInput>(
	nextConfig: T = {} as T,
	options: AtomicNextOptions = {},
): AtomicNextConfig<T> {
	const atomicLoader = resolveAtomicLoader();
	const transpilePackages = collectTranspilePackages(nextConfig, options);
	for (const pkg of transpilePackages) {
		ATOMIC_RUNTIME.transpilePackages.add(pkg);
	}
	if (options?.ignoreCss?.length) {
		ATOMIC_RUNTIME.ignoreCss.push(...options.ignoreCss);
	}
	if (options?.cssEntries?.length) {
		ATOMIC_RUNTIME.cssEntries.push(...options.cssEntries);
	}

	const monorepoRoot = findMonorepoRoot(process.cwd());
	const turbopackRoot =
		nextConfig.turbopack?.root ??
		nextConfig.outputFileTracingRoot ??
		monorepoRoot;

	return {
		...nextConfig,
		...(nextConfig.outputFileTracingRoot
			? {}
			: {outputFileTracingRoot: turbopackRoot}),
		transpilePackages: [
			...new Set([
				...(nextConfig.transpilePackages ?? []),
				...transpilePackages,
			]),
		],
		turbopack: {
			...nextConfig.turbopack,
			root: turbopackRoot,
			rules: {
				...turboLoaderRules(atomicLoader),
				...nextConfig.turbopack?.rules,
			},
		},
		webpack(config: Configuration, webpackOptions: NextWebpackOptions) {
			process.env["TAILWIND_ATOMIC_PROJECT_ROOT"] ||= process.cwd();
			ATOMIC_RUNTIME.projectRoots.unshift(process.cwd());
			ATOMIC_RUNTIME.projectRoots.push(monorepoRoot);

			config.plugins ??= [];
			config.plugins.push(
				webpackTailwindAtomic({
					...options,
					transpilePackages,
				}),
			);

			config.module ??= {rules: []};
			config.module.rules ??= [];
			config.module.rules.unshift({
				test: /\.(mjs|cjs|js|jsx|ts|tsx)$/,
				exclude: (resource: string) => shouldSkipJsTransform(resource),
				enforce: "pre",
				use: [{loader: atomicLoader}],
			});

			if (process.platform === "win32" && webpackOptions.dev) {
				config.cache = {type: "memory"};
			}

			return callUserWebpack(nextConfig.webpack, config, webpackOptions);
		},
	} as AtomicNextConfig<T>;
}
