import type {TailwindAtomicOptions} from "./index";

export function withTailwindAtomic<T extends Record<string, unknown>>(
	nextConfig?: T,
	options?: TailwindAtomicOptions,
): T;
