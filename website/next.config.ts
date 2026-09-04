import type {NextConfig} from "next";
import nextra from "nextra";

const withNextra = nextra({
	defaultShowCopyCode: true,
	search: {
		codeblocks: false,
	},
});

const nextConfig: NextConfig = {
	reactStrictMode: true,
	i18n: {
		locales: ["en", "es"],
		defaultLocale: "en",
	},
	webpack(config, {dev}) {
		if (process.platform === "win32" && dev) {
			config.cache = {type: "memory"};
		}
		return config;
	},
};

export default withNextra(nextConfig);
