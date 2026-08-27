import {createRequire} from "node:module";
import type {Configuration} from "webpack";

import webpackTailwindAtomic from "./webpack";

const req = createRequire(import.meta.url);

type NextWebpackOptions = {
	dev: boolean;
};

type NextConfig = {
	webpack?: (
		config: Configuration,
		options: NextWebpackOptions,
	) => Configuration;
};

function resolveAtomicLoader() {
	try {
		return req.resolve("./loader.cjs");
	} catch {
		return req.resolve("../dist/loader.cjs");
	}
}

export function withTailwindAtomic(
	nextConfig: NextConfig = {},
	options: Parameters<typeof webpackTailwindAtomic>[0] = {},
): NextConfig {
	const atomicLoader = resolveAtomicLoader();

	return {
		...nextConfig,
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
