import {createRequire} from "node:module";
import type {Configuration} from "webpack";

import webpackTailwindAtomic from "./webpack";

const req = createRequire(import.meta.url);

type NextWebpackOptions = {
	dev: boolean;
};

type TurboRuleOptions = {
	loaders: string[];
	as?: string;
};

/** Next 15: `foreign` = node_modules; `false` skips the loader. */
type TurboRule =
	| TurboRuleOptions
	| {
			foreign?: TurboRule | false;
			default?: TurboRule | false;
	  };

type NextConfig = {
	webpack?: (
		config: Configuration,
		options: NextWebpackOptions,
	) => Configuration;
	turbopack?: {
		root?: string;
		rules?: Record<string, TurboRule | TurboRule[]>;
		[key: string]: unknown;
	};
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
	// `file.tsx.tsx` because `*` is the full filename. Skip `*.js`: that glob
	// also hits Next internals under node_modules.
	const appSource: TurboRule = {
		foreign: false,
		default: {
			loaders: [atomicLoader],
			as: "*",
		},
	};

	return {
		"*.tsx": appSource,
		"*.ts": appSource,
		"*.jsx": appSource,
	};
}

export function withTailwindAtomic(
	nextConfig: NextConfig = {},
	options: Parameters<typeof webpackTailwindAtomic>[0] = {},
): NextConfig {
	const atomicLoader = resolveAtomicLoader();

	return {
		...nextConfig,
		turbopack: {
			...nextConfig.turbopack,
			rules: {
				...turboLoaderRules(atomicLoader),
				...nextConfig.turbopack?.rules,
			},
		},
		webpack(config: Configuration, webpackOptions: NextWebpackOptions) {
			process.env["TAILWIND_ATOMIC_PROJECT_ROOT"] ||= process.cwd();

			config.plugins ??= [];
			config.plugins.push(webpackTailwindAtomic(options));

			config.module ??= {rules: []};
			config.module.rules ??= [];
			config.module.rules.unshift({
				test: /\.(mjs|cjs|js|jsx|ts|tsx)$/,
				exclude: [/node_modules/, /[\\/]\.next[\\/]/],
				enforce: "pre",
				use: [{loader: atomicLoader}],
			});

			if (process.platform === "win32" && webpackOptions.dev) {
				config.cache = {type: "memory"};
			}

			if (typeof nextConfig.webpack === "function") {
				return nextConfig.webpack(config, webpackOptions);
			}

			return config;
		},
	};
}
