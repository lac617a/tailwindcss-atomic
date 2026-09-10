import {createRequire} from "node:module";
import {existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import type {Configuration} from "webpack";

import webpackTailwindcssAtomic from "./webpack";
import {ATOMIC_RUNTIME, ensureProjectRootEnv} from "../engine/constants";
import {shouldSkipJsTransform} from "../engine/js";
import {
	readInstalledNextVersion,
	useLegacyTurboRuleShorthand,
} from "./next-version";
import {isAtomicRuntimeModule} from "../engine/virtual-runtime";
import {
	discoverWorkspacePackageNames,
	findMonorepoRoot,
	listAppDependencyNames,
	readPackageName,
} from "../engine/workspace";
import {
	AtomicNextConfig,
	LegacyTurboRuleShorthand,
	NextConfigFields,
	NextConfigFunction,
	NextWebpackOptions,
	TurboRuleConfigCollection,
	TurboRuleConfigItem,
	TurbopackRuleCondition,
	UnpluginFactoryOptions,
} from "../types";

const req = createRequire(import.meta.url);

type AtomicNextOptions = Parameters<typeof webpackTailwindcssAtomic>[0] &
	UnpluginFactoryOptions;

function resolveAtomicLoader() {
	let dir = path.dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 6; i++) {
		const candidates = [
			path.join(dir, "loader.cjs"),
			path.join(dir, "dist", "loader.cjs"),
		];
		for (const candidate of candidates) {
			if (!existsSync(candidate)) continue;
			try {
				return req.resolve(candidate);
			} catch {
				return candidate;
			}
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	try {
		return req.resolve("./loader.cjs");
	} catch {
		return req.resolve("../dist/loader.cjs");
	}
}

/** Internal Turbopack/virtual ids are not on the project filesystem. */
const TURBOPACK_NOT_VIRTUAL: TurbopackRuleCondition = {
	not: {
		any: [{path: /\[turbopack/}, {path: /^\0/}, {path: /(?:^|[\\/])_virtual_/}],
	},
};

function withTurboLoaderCondition(
	scope: TurbopackRuleCondition,
): TurbopackRuleCondition {
	return {all: [scope, TURBOPACK_NOT_VIRTUAL]};
}

function turboLoaderRules(
	atomicLoader: string,
): Record<string, TurboRuleConfigCollection | LegacyTurboRuleShorthand> {
	// `as: '*'` keeps the original name. `as: '*.tsx'` on a `.tsx` file becomes
	// `file.tsx.tsx` because `*` is the full filename.
	//
	// `foreign` MUST also run the loader: in a Turborepo the design system lives
	// in packages/ui (outside the Next app dir) or in node_modules/.pnpm dist.
	// Webpack already rewrites those via transpilePackages; Turbopack skipped
	// them, which left mixed classNames (`flex … _cafc46`).
	//
	// Next 16.3 dropped the undocumented `{ foreign, default }` shorthand
	// (vercel/next.js#83068). `foreign` is a condition, not a sibling key.
	//
	// Virtual modules (`[turbopack-ecmascript]/worker/...`, `\0`, `_virtual_`)
	// match `*.ts` globs but are not on the project filesystem — the loader
	// would throw "needs to be on project filesystem".
	const withLoader: TurboRuleConfigItem = {
		loaders: [atomicLoader],
		as: "*",
	};
	const appAndWorkspace: TurboRuleConfigCollection | LegacyTurboRuleShorthand =
		useLegacyTurboRuleShorthand(readInstalledNextVersion())
			? {foreign: withLoader, default: withLoader}
			: [
					{
						...withLoader,
						condition: withTurboLoaderCondition("foreign"),
					},
					{
						...withLoader,
						condition: withTurboLoaderCondition({not: "foreign"}),
					},
				];

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
	nextConfig: NextConfigFields,
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

function applyAtomicNextConfig<T extends object>(
	nextConfig: T,
	options: AtomicNextOptions = {},
): AtomicNextConfig<T> {
	const config = nextConfig as T & NextConfigFields;
	const atomicLoader = resolveAtomicLoader();
	const transpilePackages = collectTranspilePackages(config, options);
	for (const pkg of transpilePackages) {
		ATOMIC_RUNTIME.transpilePackages.add(pkg);
	}
	if (options?.ignoreCss?.length) {
		ATOMIC_RUNTIME.ignoreCss.push(...options.ignoreCss);
	}
	if (options?.preserveClasses?.length) {
		ATOMIC_RUNTIME.preserveClasses.push(...options.preserveClasses);
	}
	if (options?.cssEntries?.length) {
		ATOMIC_RUNTIME.cssEntries.push(...options.cssEntries);
	}

	if (options.library) {
		console.warn(
			"[tailwindcss-atomic] `library: true` is for Rollup UI packages (preserveModules), not next.config. Ignoring so the app still hashes classNames.",
		);
	}

	const {library: _library, ...atomicOptions} = options;

	const monorepoRoot = findMonorepoRoot(process.cwd());
	const userWebpack = config.webpack;
	const turbopackRoot =
		config.turbopack?.root ?? config.outputFileTracingRoot ?? monorepoRoot;

	return {
		...config,
		...(config.outputFileTracingRoot
			? {}
			: {outputFileTracingRoot: turbopackRoot}),
		transpilePackages: [
			...new Set([...(config.transpilePackages ?? []), ...transpilePackages]),
		],
		turbopack: {
			...config.turbopack,
			root: turbopackRoot,
			rules: {
				...turboLoaderRules(atomicLoader),
				...config.turbopack?.rules,
			},
		},
		webpack(webpackConfig: Configuration, webpackOptions: NextWebpackOptions) {
			ensureProjectRootEnv(process.cwd());
			ATOMIC_RUNTIME.projectRoots.unshift(process.cwd());
			ATOMIC_RUNTIME.projectRoots.push(monorepoRoot);

			webpackConfig.plugins ??= [];
			webpackConfig.plugins.push(
				webpackTailwindcssAtomic({
					...atomicOptions,
					transpilePackages,
				}),
			);

			webpackConfig.module ??= {rules: []};
			webpackConfig.module.rules ??= [];
			webpackConfig.module.rules.unshift({
				test: /\.(mjs|cjs|js|jsx|ts|tsx)$/,
				exclude: (resource: string) =>
					!isAtomicRuntimeModule(resource) && shouldSkipJsTransform(resource),
				enforce: "pre",
				use: [{loader: atomicLoader}],
			});

			if (process.platform === "win32" && webpackOptions.dev) {
				webpackConfig.cache = {type: "memory"};
			}

			return callUserWebpack(userWebpack, webpackConfig, webpackOptions);
		},
	} as AtomicNextConfig<T>;
}

function asConfigObject(value: unknown): NextConfigFields {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as NextConfigFields;
	}
	return {};
}

export function withTailwindcssAtomic(
	nextConfig: NextConfigFunction,
	options?: AtomicNextOptions,
): (
	...args: never[]
) => Promise<AtomicNextConfig<NextConfigFields>>;
export function withTailwindcssAtomic<T extends object = NextConfigFields>(
	nextConfig?: T,
	options?: AtomicNextOptions,
): AtomicNextConfig<T>;
export function withTailwindcssAtomic<T extends object = NextConfigFields>(
	nextConfig: T | NextConfigFunction = {} as T,
	options: AtomicNextOptions = {},
):
	| AtomicNextConfig<T>
	| ((...args: never[]) => Promise<AtomicNextConfig<NextConfigFields>>) {
	if (typeof nextConfig === "function") {
		const configFn = nextConfig as NextConfigFunction;
		return async (...args: never[]) => {
			const resolved = await configFn(...args);
			return applyAtomicNextConfig(asConfigObject(resolved), options);
		};
	}

	return applyAtomicNextConfig(nextConfig as T, options);
}
