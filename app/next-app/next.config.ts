import type {NextConfig} from "next";
import {withTailwindAtomic} from "tailwindcss-atomic/next";

const nextConfig: NextConfig = {
	reactStrictMode: true,
	webpack(config, {dev}) {
		if (process.platform === "win32" && dev) {
			config.cache = {type: "memory"};
		}
		return config;
	},
};

export default withTailwindAtomic(nextConfig);
