const ATOMIC_MARKER = "/*! tailwindcss-atomic */";
const LEGACY_ATOMIC_MARKER = "/*! tailwind-atomic */";
const ATOMIC_MAP_MARKER = "/*! tailwindcss-atomic-map";
const PROJECT_ROOT_ENV = "TAILWINDCSS_ATOMIC_PROJECT_ROOT";
const LEGACY_PROJECT_ROOT_ENV = "TAILWIND_ATOMIC_PROJECT_ROOT";
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

const ATOMIC_RUNTIME_KEY = "__tailwindcssAtomicRuntime__";

type IgnoreCssPattern = string | RegExp;
type PreserveClassPattern = string | RegExp;

type AtomicRuntime = {
	viteServer: ViteDevServerLike | null;
	classMap: Record<string, string>;
	/** Stale hash → original utility. Survives CSS rebuilds that emit new hashes. */
	hashReverse: Record<string, string>;
	targetFunctions: Set<string>;
	projectRoots: string[];
	webpackWatchings: Set<WebpackWatchingLike>;
	transpilePackages: Set<string>;
	ignoreCss: IgnoreCssPattern[];
	preserveClasses: PreserveClassPattern[];
	preserveFunctions: Set<string>;
	classMapFile: string | false | undefined;
	cssEntries: string[];
};

function getAtomicRuntime(): AtomicRuntime {
	const globalRef = globalThis as typeof globalThis & {
		[ATOMIC_RUNTIME_KEY]?: AtomicRuntime;
	};
	if (!globalRef[ATOMIC_RUNTIME_KEY]) {
		globalRef[ATOMIC_RUNTIME_KEY] = {
			viteServer: null,
			classMap: Object.create(null),
			hashReverse: Object.create(null),
			targetFunctions: DEFAULT_TARGET_FUNCTIONS,
			projectRoots: [],
			webpackWatchings: new Set(),
			transpilePackages: new Set(),
			ignoreCss: [],
			preserveClasses: [],
			preserveFunctions: new Set(DEFAULT_PRESERVE_FUNCTIONS),
			classMapFile: undefined,
			cssEntries: [],
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
	if (!runtime.preserveClasses) {
		runtime.preserveClasses = [];
	}
	if (!runtime.preserveFunctions) {
		runtime.preserveFunctions = new Set(DEFAULT_PRESERVE_FUNCTIONS);
	}
	if (!runtime.cssEntries) {
		runtime.cssEntries = [];
	}
	if (!runtime.hashReverse) {
		runtime.hashReverse = Object.create(null);
	}
	return runtime;
}

const ATOMIC_RUNTIME = getAtomicRuntime();

function readProjectRootEnv(): string | undefined {
	return (
		process.env[PROJECT_ROOT_ENV] || process.env[LEGACY_PROJECT_ROOT_ENV]
	);
}

function ensureProjectRootEnv(value: string) {
	process.env[PROJECT_ROOT_ENV] ||= value;
}

function clearProjectRootEnv() {
	delete process.env[PROJECT_ROOT_ENV];
	delete process.env[LEGACY_PROJECT_ROOT_ENV];
}

const CSS_ENTRY_CANDIDATES = [
	"app/globals.css",
	"src/app/globals.css",
	"src/index.css",
	"src/globals.css",
	"src/styles/global.css",
	"src/styles/globals.css",
	"src/styles/styles.css",
	"src/styles/index.css",
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
	LEGACY_ATOMIC_MARKER,
	ATOMIC_MAP_MARKER,
	PROJECT_ROOT_ENV,
	LEGACY_PROJECT_ROOT_ENV,
	TAILWIND_DIRECTIVE_RE,
	NESTED_AT_RULES,
	ATOMIC_RUNTIME,
	CSS_ENTRY_CANDIDATES,
	DEFAULT_TARGET_FUNCTIONS,
	DEFAULT_PRESERVE_FUNCTIONS,
	readProjectRootEnv,
	ensureProjectRootEnv,
	clearProjectRootEnv,
};

export type {IgnoreCssPattern, PreserveClassPattern};
