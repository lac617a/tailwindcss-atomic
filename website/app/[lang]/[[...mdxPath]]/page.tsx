import {useMDXComponents} from "../../../mdx-components";
import {generateStaticParamsFor, importPage} from "nextra/pages";

export const generateStaticParams = generateStaticParamsFor("mdxPath");

type PageProps = Readonly<{
	params: Promise<{
		mdxPath?: string[];
		lang: string;
	}>;
}>;

export async function generateMetadata(props: PageProps) {
	const params = await props.params;
	const {metadata} = await importPage(params.mdxPath, params.lang);
	return metadata;
}

const Wrapper = useMDXComponents().wrapper;

export default async function Page(props: PageProps) {
	const params = await props.params;
	const {
		default: MDXContent,
		toc,
		metadata,
		sourceCode,
	} = await importPage(params.mdxPath, params.lang);

	return (
		<Wrapper toc={toc} metadata={metadata} sourceCode={sourceCode}>
			<MDXContent {...props} params={params} />
		</Wrapper>
	);
}
