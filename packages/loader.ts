import type {LoaderContext} from "webpack";

import {transformAtomicSource} from "./core/factory";
import {isAtomicRuntimeModule} from "./shared/virtual-runtime";

async function tailwindAtomicWebpackLoader(
	this: LoaderContext<{resourcePath: string}>,
	source: string,
) {
	const callback = this.async();
	if (isAtomicRuntimeModule(this.resourcePath)) {
		this.cacheable?.(false);
	}

	const {code} = await transformAtomicSource(source, this.resourcePath);

	callback(null, code != null ? code : source);
}

export default tailwindAtomicWebpackLoader;
