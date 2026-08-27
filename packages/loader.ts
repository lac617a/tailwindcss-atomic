import type {LoaderContext} from "webpack";

import {transformAtomicSource} from "./core/factory";

async function tailwindAtomicWebpackLoader(
	this: LoaderContext<{resourcePath: string}>,
	source: string,
) {
	const callback = this.async();

	const {code} = await transformAtomicSource(source, this.resourcePath);

	callback(null, code != null ? code : source);
}

export default tailwindAtomicWebpackLoader;
