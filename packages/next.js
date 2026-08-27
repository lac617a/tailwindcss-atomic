import {createRequire} from "node:module";
import {webpackTailwindAtomic} from "./index.js";

const req = createRequire(import.meta.url);

function resolveAtomicLoader() {
	try {
		return req.resolve("../webpack-loader.cjs");
	} catch {
		return req.resolve("../../webpack-loader.cjs");
	}
}

export function withTailwindAtomic(nextConfig = {}, options = {}) {
	const atomicLoader = resolveAtomicLoader();

	return {
		...nextConfig,
		webpack(config, webpackOptions) {
			config.plugins.push(webpackTailwindAtomic(options));

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