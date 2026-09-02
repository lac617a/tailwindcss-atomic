import {UnpluginFactory} from "unplugin";

type OutputAsset = {
	type: "asset";
	fileName: string;
	source: string | Uint8Array;
};

type OutputChunk = {
	type: "chunk";
	fileName: string;
	code: string;
};

type OutputBundle = Record<string, OutputAsset | OutputChunk>;

interface UnpluginFactoryOptions {
	targetFunctions?: Set<string>;
	tailwindCss?: string;
	transpilePackages?: string[];
	ignoreCss?: Array<string | RegExp>;
	preserveFunctions?: Iterable<string>;
	classMapFile?: string | boolean;
	cssEntries?: string[];
}

type UnpluginFactoryFunction = Partial<UnpluginFactory<UnpluginFactoryOptions>>;

type WebpackCssModule = {resource?: string; userRequest?: string};

export type {
	OutputAsset,
	OutputChunk,
	OutputBundle,
	WebpackCssModule,
	UnpluginFactoryFunction,
	UnpluginFactoryOptions,
};
