import path from "node:path";

import {ATOMIC_RUNTIME} from "../src/engine/constants";
import loader from "../src/adapters/loader";

describe("webpack loader", () => {
	it("rewrites JS sources through transformAtomicSource", async () => {
		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";

		const code = await new Promise<string | undefined>((resolve, reject) => {
			const ctx = {
				resourcePath: "/tmp/app/src/App.tsx",
				async() {
					return (error: Error | null, next?: string) => {
						if (error) reject(error);
						else resolve(next);
					};
				},
			};

			void loader.call(
				ctx as never,
				`export const n = <div className="flex" />;`,
			);
		});

		expect(code).toContain("_aaaaaa");
	});

	it("watches the class-map file so stale hashed JS is rebuilt", async () => {
		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";
		ATOMIC_RUNTIME.classMapFile = "/tmp/atomic-class-map.json";
		const addDependency = vi.fn();
		const addMissingDependency = vi.fn();
		const addContextDependency = vi.fn();

		await new Promise<string | undefined>((resolve, reject) => {
			const ctx = {
				resourcePath: "/tmp/app/src/App.tsx",
				addDependency,
				addMissingDependency,
				addContextDependency,
				async() {
					return (error: Error | null, next?: string) => {
						if (error) reject(error);
						else resolve(next);
					};
				},
			};
			void loader.call(
				ctx as never,
				`export const n = <div className="flex" />;`,
			);
		});

		expect(addContextDependency).toHaveBeenCalledWith(
			path.dirname("/tmp/atomic-class-map.json"),
		);
		expect(addMissingDependency).toHaveBeenCalledWith(
			"/tmp/atomic-class-map.json",
		);
	});

	it("falls back to the original source when nothing changes", async () => {
		const source = "export const n = 1;";
		const code = await new Promise<string | undefined>((resolve, reject) => {
			const ctx = {
				resourcePath: "/tmp/app/src/plain.ts",
				async() {
					return (error: Error | null, next?: string) => {
						if (error) reject(error);
						else resolve(next);
					};
				},
			};

			void loader.call(ctx as never, source);
		});

		expect(code).toBe(source);
	});
});
