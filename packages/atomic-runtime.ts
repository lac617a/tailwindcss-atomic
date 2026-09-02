/** Fallback if a bundler loads this file without the atomic loader. */
export function atomicReconcile<T>(value: T): T {
	return value;
}

export function atomicClassName<T>(value: T): T {
	return value;
}
