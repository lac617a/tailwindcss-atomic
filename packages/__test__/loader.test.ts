import {ATOMIC_RUNTIME} from "../shared/constants";
import loader from "../loader";

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
