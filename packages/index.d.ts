import type {Plugin as PostcssPlugin} from "postcss";
import type {UnpluginInstance} from "unplugin";

export interface TailwindAtomicOptions {
	targetFunctions?: string[];
	tailwindCss?: string;
}

export async function transformAtomicSource(
	code: string,
	id: string,
): Promise<{code: string; map?: unknown} | null>;

export const TailwindAtomicPlugin: UnpluginInstance<
	TailwindAtomicOptions | undefined
>;

export const viteTailwindAtomic: UnpluginInstance<
	TailwindAtomicOptions | undefined
>["vite"];

export const webpackTailwindAtomic: UnpluginInstance<
	TailwindAtomicOptions | undefined
>["webpack"];

export const rollupTailwindAtomic: UnpluginInstance<
	TailwindAtomicOptions | undefined
>["rollup"];
