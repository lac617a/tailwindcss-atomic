import {ATOMIC_RUNTIME} from "../src/engine/constants";
import {
	generateRuntimeModule,
	isEmittedVirtualRuntimePath,
	rewriteEmittedRuntimeImports,
} from "../src/engine/virtual-runtime";

function instantiateRuntime(
	source: string,
	twMergeImpl?: string,
) {
	const exports: {
		atomicReconcile?: (value: unknown) => unknown;
		atomicClassName?: (value: unknown) => unknown;
	} = {};
	let body = source.replace(
		/export \{ atomicReconcile, rewrite as atomicClassName \};/,
		"exports.atomicReconcile = atomicReconcile; exports.atomicClassName = rewrite;",
	);
	if (twMergeImpl) {
		body = body.replace("const twMerge = (value) => value;", twMergeImpl);
	}
	new Function("exports", body)(exports);
	return {
		atomicReconcile: exports.atomicReconcile as (value: unknown) => unknown,
		atomicClassName: exports.atomicClassName as (value: unknown) => unknown,
	};
}

describe("atomicReconcile runtime", () => {
	beforeEach(() => {
		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";
		ATOMIC_RUNTIME.classMap["hidden"] = "_cccccc";
		ATOMIC_RUNTIME.classMap["p-4"] = "_bbbbbb";
	});

	it("keeps CSS module locals even when twMerge would drop them", () => {
		const {atomicReconcile} = instantiateRuntime(
			generateRuntimeModule(),
			`const twMerge = (value) => String(value).split(/\\s+/).filter((cls) => !String(cls).includes("__")).join(" ");`,
		);

		expect(
			atomicReconcile("Nexi_nexi__abc12 _aaaaaa Nexi_stIdle__def34"),
		).toBe("Nexi_nexi__abc12 _aaaaaa Nexi_stIdle__def34");
		expect(atomicReconcile("nexi_body__xK3p2")).toBe("nexi_body__xK3p2");
	});

	it("still merges hashed Tailwind classes around CSS modules", () => {
		const {atomicReconcile} = instantiateRuntime(
			generateRuntimeModule(),
			`const twMerge = (value) => {
				const tokens = String(value).split(/\\s+/).filter(Boolean);
				if (tokens.includes("hidden") && tokens.includes("flex")) {
					return tokens.filter((cls) => cls !== "flex").join(" ");
				}
				return tokens.join(" ");
			};`,
		);

		expect(atomicReconcile("_aaaaaa Nexi_nexi__abc12 _cccccc")).toBe(
			"_cccccc Nexi_nexi__abc12",
		);
	});

	it("rewrites original Tailwind tokens and leaves foreign classes", () => {
		const {atomicReconcile} = instantiateRuntime(generateRuntimeModule());
		expect(atomicReconcile("flex my-widget p-4")).toBe(
			"_aaaaaa _bbbbbb my-widget",
		);
	});

	it("remaps stale hashes after the class-map moves on", () => {
		ATOMIC_RUNTIME.classMap["bg-neutral-300"] = "_de1682 _c8588e _2f8a31";
		ATOMIC_RUNTIME.hashReverse["_ce2951"] = "bg-neutral-300";
		const {atomicReconcile} = instantiateRuntime(generateRuntimeModule());
		expect(atomicReconcile("_ce2951")).toBe("_de1682 _c8588e _2f8a31");
	});

	it("keeps before/after content tokens that contain quotes", () => {
		ATOMIC_RUNTIME.classMap["before:content-['']"] = "_bemp01";
		ATOMIC_RUNTIME.classMap["after:content-['*']"] = "_astar1";
		const {atomicReconcile} = instantiateRuntime(generateRuntimeModule());
		expect(atomicReconcile("before:content-[''] after:content-['*']")).toBe(
			"_bemp01 _astar1",
		);
	});
});

describe("preserveModules runtime specifiers", () => {
	it("detects emitted virtual runtime chunks", () => {
		expect(isEmittedVirtualRuntimePath("\0tailwindcss-atomic-runtime")).toBe(true);
		expect(
			isEmittedVirtualRuntimePath("_virtual/tailwindcss-atomic-runtime.js"),
		).toBe(true);
		expect(isEmittedVirtualRuntimePath("tailwindcss-atomic/runtime")).toBe(
			false,
		);
		expect(isEmittedVirtualRuntimePath("components/alert.js")).toBe(false);
	});

	it("rewrites relative virtual imports to the package subpath", () => {
		expect(
			rewriteEmittedRuntimeImports(
				`import { atomicReconcile as _twAtomicReconcile } from "../_virtual/tailwindcss-atomic-runtime.js";`,
			),
		).toBe(
			`import { atomicReconcile as _twAtomicReconcile } from "tailwindcss-atomic/runtime";`,
		);
		expect(
			rewriteEmittedRuntimeImports(
				`import { atomicReconcile } from "tailwindcss-atomic/runtime";`,
			),
		).toBe(`import { atomicReconcile } from "tailwindcss-atomic/runtime";`);
	});
});
