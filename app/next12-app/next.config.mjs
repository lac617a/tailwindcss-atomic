import {withTailwindAtomic} from "tailwindcss-atomic/next";

/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	webpack(config, {dev}) {
		if (process.platform === "win32" && dev) {
			config.cache = {type: "memory"};
		}
		return config;
	},
};

export default withTailwindAtomic(nextConfig);
