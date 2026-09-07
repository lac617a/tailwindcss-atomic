import {
	isAtomicRuntimeModule,
	isVirtualRuntimeLoadId,
	VIRTUAL_RUNTIME_IMPORT,
	VIRTUAL_RUNTIME_RESOLVED,
} from "../shared/virtual-runtime";

describe("isVirtualRuntimeLoadId", () => {
	it("matches the resolved virtual id and webpack/rspack encodings", () => {
		const encoded = encodeURIComponent(VIRTUAL_RUNTIME_RESOLVED);
		expect(isVirtualRuntimeLoadId(VIRTUAL_RUNTIME_RESOLVED)).toBe(true);
		expect(isVirtualRuntimeLoadId(`/tmp/app/_virtual_${encoded}`)).toBe(true);
		expect(
			isVirtualRuntimeLoadId(`C:\\tmp\\app\\_virtual_${encoded}`),
		).toBe(true);
		expect(
			isVirtualRuntimeLoadId(
				`/tmp/app/__virtual__/tailwind-atomic-plugin/${encoded}`,
			),
		).toBe(true);
		expect(
			isVirtualRuntimeLoadId(`/tmp/app/_virtual_${encoded}?v=1`),
		).toBe(true);
	});

	it("rejects JSON, app source, and unrelated virtual files", () => {
		expect(isVirtualRuntimeLoadId("messages/en.json")).toBe(false);
		expect(isVirtualRuntimeLoadId("/app/messages/en.json")).toBe(false);
		expect(isVirtualRuntimeLoadId("src/app.tsx")).toBe(false);
		expect(isVirtualRuntimeLoadId(VIRTUAL_RUNTIME_IMPORT)).toBe(false);
		expect(isVirtualRuntimeLoadId("/tmp/app/_virtual_%00other")).toBe(false);
		expect(isVirtualRuntimeLoadId("")).toBe(false);
	});
});

describe("isAtomicRuntimeModule", () => {
	it("keeps package and dist runtime files", () => {
		expect(isAtomicRuntimeModule(VIRTUAL_RUNTIME_IMPORT)).toBe(true);
		expect(isAtomicRuntimeModule(VIRTUAL_RUNTIME_RESOLVED)).toBe(true);
		expect(
			isAtomicRuntimeModule(
				"node_modules/tailwindcss-atomic/dist/atomic-runtime.mjs",
			),
		).toBe(true);
		expect(isAtomicRuntimeModule("messages/en.json")).toBe(false);
	});
});
