const ATOMIC_MARKER = "/*! tailwind-atomic */";
const TAILWIND_DIRECTIVE_RE =
	/@tailwind\b|@(?:import|use|reference)\s+["']tailwindcss(?:\/[^"']*)?["']/;

const NESTED_AT_RULES = new Set(["media", "supports", "container"]);

const DEFAULT_TARGET_FUNCTIONS = new Set([
	"clsx",
	"class",
	"classnames",
	"cn",
	"cx",
	"cva",
	"tw",
	"twMerge",
	"clsxMerge",
]);

const DEFAULT_PRESERVE_FUNCTIONS = new Set(["twIgnore"]);

interface ViteModuleGraph {
	idToModuleMap: Map<string, unknown>;
	invalidateModule(mod: unknown): void;
}

interface ViteDevServerLike {
	moduleGraph: ViteModuleGraph;
}

type WebpackWatchingLike = {
	invalidate?: () => void;
};

const ATOMIC_RUNTIME_KEY = "__tailwindAtomicRuntime__";

type IgnoreCssPattern = string | RegExp;

type AtomicRuntime = {
	viteServer: ViteDevServerLike | null;
	classMap: Record<string, string>;
	targetFunctions: Set<string>;
	projectRoots: string[];
	webpackWatchings: Set<WebpackWatchingLike>;
	transpilePackages: Set<string>;
	ignoreCss: IgnoreCssPattern[];
	preserveFunctions: Set<string>;
	classMapFile: string | false | undefined;
};

function getAtomicRuntime(): AtomicRuntime {
	const globalRef = globalThis as typeof globalThis & {
		[ATOMIC_RUNTIME_KEY]?: AtomicRuntime;
	};
	if (!globalRef[ATOMIC_RUNTIME_KEY]) {
		globalRef[ATOMIC_RUNTIME_KEY] = {
			viteServer: null,
			classMap: Object.create(null),
			targetFunctions: DEFAULT_TARGET_FUNCTIONS,
			projectRoots: [],
			webpackWatchings: new Set(),
			transpilePackages: new Set(),
			ignoreCss: [],
			preserveFunctions: new Set(DEFAULT_PRESERVE_FUNCTIONS),
			classMapFile: undefined,
		};
	}
	const runtime = globalRef[ATOMIC_RUNTIME_KEY];
	if (!runtime.webpackWatchings) {
		runtime.webpackWatchings = new Set();
	}
	if (!runtime.transpilePackages) {
		runtime.transpilePackages = new Set();
	}
	if (!runtime.ignoreCss) {
		runtime.ignoreCss = [];
	}
	if (!runtime.preserveFunctions) {
		runtime.preserveFunctions = new Set(DEFAULT_PRESERVE_FUNCTIONS);
	}
	return runtime;
}

const ATOMIC_RUNTIME = getAtomicRuntime();

const CSS_ENTRY_CANDIDATES = [
	"app/globals.css",
	"src/app/globals.css",
	"src/index.css",
	"src/globals.css",
	"app/index.css",
	"styles/index.css",
	"styles/globals.css",
	"css/index.css",
	"css/styles.css",
	"css/globals.css",
	"scss/index.scss",
	"scss/styles.scss",
	"scss/globals.scss",
	"app/styles.scss",
	"src/app/styles.scss",
	"src/styles.scss",
] as const;

export {
	ATOMIC_MARKER,
	TAILWIND_DIRECTIVE_RE,
	NESTED_AT_RULES,
	ATOMIC_RUNTIME,
	CSS_ENTRY_CANDIDATES,
	DEFAULT_TARGET_FUNCTIONS,
	DEFAULT_PRESERVE_FUNCTIONS,
};

export type {IgnoreCssPattern};
