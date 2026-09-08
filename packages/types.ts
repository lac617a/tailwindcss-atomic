import {UnpluginFactory} from "unplugin";
import type {Configuration} from "webpack";

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
	/**
	 * Class names that look like Tailwind utilities but must stay literal
	 * (`.text-logo`, `.flex-container`). Strings match exactly; regexes test
	 * the unescaped name.
	 */
	preserveClasses?: Array<string | RegExp>;
	preserveFunctions?: Iterable<string>;
	classMapFile?: string | boolean;
	cssEntries?: string[];
	/**
	 * Rewrite JS assets in webpack `processAssets`. Off by default: source
	 * modules are already transformed by the loader, and emitting a bare
	 * `import` into CommonJS chunks (Next.js server) breaks `next build`.
	 * When enabled, JS is still skipped unless the compilation emits ESM.
	 */
	transformEmittedJs?: boolean;
	/**
	 * Design-system builds (`preserveModules` UI packages). Leave original
	 * Tailwind class names in JS so the consuming app can generate CSS and
	 * hash. Default: auto — on when Rollup `preserveModules` is set.
	 */
	library?: boolean;
}

type UnpluginFactoryFunction = Partial<UnpluginFactory<UnpluginFactoryOptions>>;

type WebpackCssModule = {resource?: string; userRequest?: string};

type NextWebpackOptions = {
	dev: boolean;
	[key: string]: unknown;
};

type TurbopackLoaderBuiltinCondition =
	| "browser"
	| "foreign"
	| "development"
	| "production"
	| "node"
	| "edge-light";

type TurbopackPathCondition = {
	path?: string | RegExp;
	query?: string | RegExp;
	content?: RegExp;
	contentType?: string | RegExp;
};

type TurbopackRuleCondition =
	| TurbopackLoaderBuiltinCondition
	| TurbopackPathCondition
	| {not: TurbopackRuleCondition}
	| {all: TurbopackRuleCondition[]}
	| {any: TurbopackRuleCondition[]};

type TurboRuleConfigItem = {
	loaders: string[];
	as?: string;
	condition?: TurbopackRuleCondition;
};

/** Next 16: `condition` selects when a rule runs. Arrays apply every match. */
type TurboRuleConfigCollection = TurboRuleConfigItem | TurboRuleConfigItem[];

/** Next 15.2 and earlier: nested keys, not `condition`. */
type LegacyTurboRuleShorthand = {
	foreign?: TurboRuleConfigItem | false;
	default?: TurboRuleConfigItem | false;
};

/** Fields we read from Next.js config. `T extends object` so Next's own types stay assignable. */
type NextConfigFields = {
	webpack?: ((...args: never[]) => unknown) | null;
	transpilePackages?: string[];
	outputFileTracingRoot?: string;
	turbopack?: {
		root?: string;
		rules?: Record<string, unknown>;
		resolveAlias?: Record<string, string | string[]>;
	} | null;
};

type AtomicNextConfig<T> = Omit<
	T,
	"webpack" | "turbopack" | "transpilePackages" | "outputFileTracingRoot"
> & {
	transpilePackages: string[];
	outputFileTracingRoot?: string;
	turbopack: {
		root: string;
		rules: Record<string, TurboRuleConfigCollection>;
		resolveAlias?: Record<string, string | string[]>;
	};
	webpack: (
		config: Configuration,
		options: NextWebpackOptions,
	) => Configuration;
};

export type {
	OutputAsset,
	OutputChunk,
	OutputBundle,
	WebpackCssModule,
	UnpluginFactoryFunction,
	UnpluginFactoryOptions,
	AtomicNextConfig,
	NextWebpackOptions,
	TurbopackLoaderBuiltinCondition,
	TurbopackPathCondition,
	TurbopackRuleCondition,
	TurboRuleConfigItem,
	TurboRuleConfigCollection,
	LegacyTurboRuleShorthand,
	NextConfigFields,
};
