import {existsSync, mkdirSync} from "node:fs";
import path from "node:path";
import type {LoaderContext} from "webpack";

import {transformAtomicSource} from "../engine/factory";
import {classMapFilePath} from "../engine/css";
import {isAtomicRuntimeModule} from "../engine/virtual-runtime";

function watchClassMap(loader: LoaderContext<{resourcePath: string}>) {
	const mapFile = classMapFilePath();
	if (!mapFile) {
		loader.cacheable?.(false);
		return;
	}
	const cacheDir = path.dirname(mapFile);
	try {
		mkdirSync(cacheDir, {recursive: true});
	} catch {
		// Watching still works if the directory already exists.
	}
	loader.addContextDependency?.(cacheDir);
	if (existsSync(mapFile)) {
		loader.addDependency(mapFile);
		return;
	}
	loader.addMissingDependency?.(mapFile);
}

async function tailwindAtomicWebpackLoader(
	this: LoaderContext<{resourcePath: string}>,
	source: string,
) {
	const callback = this.async();
	if (isAtomicRuntimeModule(this.resourcePath)) {
		this.cacheable?.(false);
	} else {
		watchClassMap(this);
	}

	const {code} = await transformAtomicSource(source, this.resourcePath);

	callback(null, code != null ? code : source);
}

export default tailwindAtomicWebpackLoader;
