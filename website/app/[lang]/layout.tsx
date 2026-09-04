import {Logo} from "@app/_components/logo";
import {getDictionary, getDirection} from "@app/_dictionaries/get-dictionary";
import {i18n} from "@app/_dictionaries/i18n-config";
import type {Metadata} from "next";
import {
	Footer,
	LastUpdated,
	Layout,
	LocaleSwitch,
	Navbar,
} from "nextra-theme-docs";
import {Banner, Head} from "nextra/components";
import {getPageMap} from "nextra/page-map";
import type {FC, ReactNode} from "react";
import "./styles.css";

export const metadata: Metadata = {
	metadataBase: new URL("https://atomic.profiya.com"),
	description:
		"Atomic CSS classes for Tailwind. Split every declaration, rewrite classNames to short hashes, keep hover and breakpoints.",
	title: {
		default: "tailwindcss-atomic",
		template: "%s | tailwindcss-atomic",
	},
};

type LayoutProps = Readonly<{
	children: ReactNode;
	params: Promise<{
		lang: string;
	}>;
}>;

export async function generateStaticParams() {
	return i18n.locales.map((lang) => ({lang}));
}

const RootLayout: FC<LayoutProps> = async ({children, params}) => {
	const {lang} = await params;
	const dictionary = await getDictionary(lang);
	const pageMap = await getPageMap(`/${lang}`);

	const banner = (
		<Banner storageKey="atomic-v1">{dictionary.banner}</Banner>
	);

	const navbar = (
		<Navbar
			logo={<Logo />}
			logoLink={`/${lang}`}
			projectLink="https://github.com/lac617a/tailwindcss-atomic"
		>
			<LocaleSwitch />
		</Navbar>
	);

	const footer = (
		<Footer>
			MIT {new Date().getFullYear()} ©{" "}
			<a
				href="https://github.com/lac617a"
				rel="noreferrer"
				target="_blank"
			>
				lac617a
			</a>
		</Footer>
	);

	return (
		<html
			lang={lang}
			dir={getDirection(lang as (typeof i18n.locales)[number])}
			suppressHydrationWarning
		>
			<Head />
			<body>
				<Layout
					banner={banner}
					navbar={navbar}
					footer={footer}
					pageMap={pageMap}
					docsRepositoryBase="https://github.com/lac617a/tailwindcss-atomic/tree/main/website"
					editLink={dictionary.editPage}
					lastUpdated={
						<LastUpdated locale={lang}>
							{dictionary.lastUpdated}
						</LastUpdated>
					}
					themeSwitch={{
						dark: dictionary.dark,
						light: dictionary.light,
						system: dictionary.system,
					}}
					i18n={[
						{locale: "en", name: "English"},
						{locale: "es", name: "Español"},
					]}
				>
					{children}
				</Layout>
			</body>
		</html>
	);
};

export default RootLayout;
