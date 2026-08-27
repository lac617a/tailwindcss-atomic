const ATOMIC_MARKER = "/*! tailwind-atomic */";
const TAILWIND_DIRECTIVE_RE =
	/@tailwind\b|@(?:import|use|reference)\s+["']tailwindcss(?:\/[^"']*)?["']/;

const NESTED_AT_RULES = new Set(["media", "supports", "container"]);

const DEFAULT_TARGET_FUNCTIONS = new Set([
	"clsx",
	"class",
	"classnames",
	"cn",
	"cva",
	"tw",
	"twMerge",
	"clsxMerge",
]);

interface ViteModuleGraph {
	idToModuleMap: Map<string, unknown>;
	invalidateModule(mod: unknown): void;
}

interface ViteDevServerLike {
	moduleGraph: ViteModuleGraph;
}

const ATOMIC_RUNTIME_KEY = "__tailwindAtomicRuntime__";

type AtomicRuntime = {
	viteServer: ViteDevServerLike | null;
	classMap: Record<string, string>;
	targetFunctions: Set<string>;
	projectRoots: string[];
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
		};
	}
	return globalRef[ATOMIC_RUNTIME_KEY];
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
] as const;

export {
	ATOMIC_MARKER,
	TAILWIND_DIRECTIVE_RE,
	NESTED_AT_RULES,
	ATOMIC_RUNTIME,
	CSS_ENTRY_CANDIDATES,
	DEFAULT_TARGET_FUNCTIONS,
};
