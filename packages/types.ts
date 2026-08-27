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

export type {OutputAsset, OutputChunk, OutputBundle};
