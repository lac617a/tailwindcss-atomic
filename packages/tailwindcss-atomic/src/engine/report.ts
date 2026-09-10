import {gzipSync} from "node:zlib";

import {ATOMIC_RUNTIME} from "./constants";

const REPORT_ENV = "TAILWINDCSS_ATOMIC_REPORT";

type ReportMode = false | "text" | "json";
type ReportOption = boolean | "json";

type WasmAtomicStats = {
	input_bytes?: number;
	output_bytes?: number;
	utilities?: number;
	atomic_rules?: number;
	declarations?: number;
	shared_hashes?: number;
	elapsed_us?: number;
	changed?: boolean;
};

type ClassMapTotals = {
	utilities: number;
	atomicRules: number;
	declarations: number;
	sharedHashes: number;
};

type AtomicReportSnapshot = {
	css: {
		beforeBytes: number;
		afterBytes: number;
		beforeGzip: number;
		afterGzip: number;
	};
	utilities: number;
	atomicRules: number;
	declarations: number;
	sharedHashes: number;
	classStrings: {
		beforeBytes: number;
		afterBytes: number;
		beforeGzip: number;
		afterGzip: number;
	};
	compileMs: number;
};

type ReportState = {
	cssBefore: string;
	cssAfter: string;
	classBefore: string;
	classAfter: string;
	cssKeys: Set<string>;
	classKeys: Set<string>;
	elapsedUs: number;
	flushed: boolean;
	bundlerAttached: boolean;
	optionMode: ReportOption | undefined;
	flushTimer: ReturnType<typeof setTimeout> | null;
};

function emptyState(): ReportState {
	return {
		cssBefore: "",
		cssAfter: "",
		classBefore: "",
		classAfter: "",
		cssKeys: new Set(),
		classKeys: new Set(),
		elapsedUs: 0,
		flushed: false,
		bundlerAttached: false,
		optionMode: undefined,
		flushTimer: null,
	};
}

const state: ReportState = emptyState();

function djb2(value: string) {
	let hash = 5381;
	for (let i = 0; i < value.length; i++) {
		hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
	}
	return (hash >>> 0).toString(16);
}

function gzipBytes(value: string) {
	if (!value) return 0;
	return gzipSync(Buffer.from(value)).length;
}

function parseEnvMode(value: string | undefined): ReportMode {
	const env = value?.trim().toLowerCase();
	if (!env) return false;
	if (env === "json") return "json";
	if (env === "1" || env === "true" || env === "text" || env === "yes") {
		return "text";
	}
	return false;
}

function resolveReportMode(): ReportMode {
	if (state.optionMode === false) return false;
	if (state.optionMode === "json") return "json";
	if (state.optionMode === true) return "text";
	return parseEnvMode(process.env[REPORT_ENV]);
}

function isReportEnabled() {
	return resolveReportMode() !== false;
}

function configureAtomicReport(option?: ReportOption) {
	state.optionMode = option;
}

function markBundlerReport() {
	state.bundlerAttached = true;
	process.env.TAILWINDCSS_ATOMIC_BUNDLER = "1";
	cancelScheduledFlush();
}

function isBundlerAttached() {
	return state.bundlerAttached || process.env.TAILWINDCSS_ATOMIC_BUNDLER === "1";
}

function cancelScheduledFlush() {
	if (!state.flushTimer) return;
	clearTimeout(state.flushTimer);
	state.flushTimer = null;
}

function resetAtomicReport(options?: {keepConfig?: boolean}) {
	cancelScheduledFlush();
	const bundlerAttached = options?.keepConfig ? state.bundlerAttached : false;
	const optionMode = options?.keepConfig ? state.optionMode : undefined;
	Object.assign(state, emptyState());
	state.bundlerAttached = bundlerAttached;
	state.optionMode = optionMode;
	if (!bundlerAttached) {
		delete process.env.TAILWINDCSS_ATOMIC_BUNDLER;
	}
}

function shouldSkipDevReport() {
	return ATOMIC_RUNTIME.viteServer != null;
}

function recordCssTransform(input: string, output: string, elapsedUs = 0) {
	if (!isReportEnabled() || !input || input === output) return;
	const key = `${input.length}:${output.length}:${djb2(input)}`;
	if (state.cssKeys.has(key)) return;
	state.cssKeys.add(key);
	state.cssBefore += input;
	state.cssAfter += output;
	if (elapsedUs > 0) state.elapsedUs += elapsedUs;
}

function recordClassStringTransform(before: string, after: string) {
	if (!isReportEnabled() || !before || before === after) return;
	const key = `${before.length}:${after.length}:${djb2(before)}`;
	if (state.classKeys.has(key)) return;
	state.classKeys.add(key);
	state.classBefore += before;
	state.classAfter += after;
}

function classMapTotals(classMap: Record<string, string>): ClassMapTotals {
	const hashUses = new Map<string, number>();
	let utilities = 0;
	let declarations = 0;
	for (const [name, hashes] of Object.entries(classMap)) {
		if (!name || name.startsWith("__") || typeof hashes !== "string") continue;
		utilities += 1;
		for (const hash of hashes.split(/\s+/)) {
			if (!hash) continue;
			declarations += 1;
			hashUses.set(hash, (hashUses.get(hash) ?? 0) + 1);
		}
	}
	let sharedHashes = 0;
	for (const count of hashUses.values()) {
		if (count > 1) sharedHashes += 1;
	}
	return {
		utilities,
		atomicRules: hashUses.size,
		declarations,
		sharedHashes,
	};
}

function snapshotAtomicReport(): AtomicReportSnapshot | null {
	const totals = classMapTotals(ATOMIC_RUNTIME.classMap);
	if (!state.cssBefore && !state.classBefore && totals.utilities === 0) {
		return null;
	}
	return {
		css: {
			beforeBytes: byteLength(state.cssBefore),
			afterBytes: byteLength(state.cssAfter),
			beforeGzip: gzipBytes(state.cssBefore),
			afterGzip: gzipBytes(state.cssAfter),
		},
		utilities: totals.utilities,
		atomicRules: totals.atomicRules,
		declarations: totals.declarations,
		sharedHashes: totals.sharedHashes,
		classStrings: {
			beforeBytes: byteLength(state.classBefore),
			afterBytes: byteLength(state.classAfter),
			beforeGzip: gzipBytes(state.classBefore),
			afterGzip: gzipBytes(state.classAfter),
		},
		compileMs: Math.round((state.elapsedUs / 1000) * 10) / 10,
	};
}

function byteLength(value: string) {
	return Buffer.byteLength(value);
}

function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb >= 10 ? kb.toFixed(1) : kb.toFixed(2)} kB`;
	return `${(kb / 1024).toFixed(2)} MB`;
}

function formatDelta(before: number, after: number) {
	if (before <= 0) {
		return after > 0 ? `+${formatBytes(after)}` : "—";
	}
	const percent = Math.round(((after - before) / before) * 100);
	const sign = percent > 0 ? "+" : "";
	return `${sign}${percent}%`;
}

function pad(label: string, width = 16) {
	return label.padEnd(width);
}

function formatPair(before: number, after: number) {
	return `${formatBytes(before).padStart(10)}  →  ${formatBytes(after).padStart(10)}   (${formatDelta(before, after)})`;
}

function formatAtomicReport(snapshot: AtomicReportSnapshot) {
	const lines = [
		"[tailwindcss-atomic] report",
		"",
		`  ${pad("CSS")}${formatPair(snapshot.css.beforeBytes, snapshot.css.afterBytes)}`,
		`  ${pad("CSS gzip")}${formatPair(snapshot.css.beforeGzip, snapshot.css.afterGzip)}`,
		`  ${pad("utilities")}${String(snapshot.utilities).padStart(10)}  →  ${String(snapshot.atomicRules).padStart(10)}   atomic rules`,
		`  ${pad("shared hashes")}${String(snapshot.sharedHashes).padStart(10)}     (${snapshot.declarations} declarations)`,
		`  ${pad("class strings")}${formatPair(snapshot.classStrings.beforeBytes, snapshot.classStrings.afterBytes)}`,
		`  ${pad("class gzip")}${formatPair(snapshot.classStrings.beforeGzip, snapshot.classStrings.afterGzip)}`,
	];
	if (snapshot.compileMs > 0) {
		lines.push(`  ${pad("compile")}${String(snapshot.compileMs).padStart(10)} ms`);
	}
	return lines.join("\n");
}

function printAtomicReport(snapshot: AtomicReportSnapshot, mode: Exclude<ReportMode, false>) {
	if (mode === "json") {
		console.log(
			`[tailwindcss-atomic] report ${JSON.stringify(snapshot)}`,
		);
		return;
	}
	console.log(formatAtomicReport(snapshot));
}

function flushAtomicReport() {
	cancelScheduledFlush();
	if (state.flushed || shouldSkipDevReport()) return;
	const mode = resolveReportMode();
	if (mode === false) return;
	const snapshot = snapshotAtomicReport();
	if (!snapshot) return;
	state.flushed = true;
	printAtomicReport(snapshot, mode);
}

function scheduleReportFlush(delay = 20) {
	if (isBundlerAttached() || shouldSkipDevReport() || !isReportEnabled()) {
		return;
	}
	scheduleFlush(delay);
}

function scheduleBundlerFlush(delay = 80) {
	if (shouldSkipDevReport() || !isReportEnabled()) return;
	scheduleFlush(delay);
}

function scheduleFlush(delay: number) {
	cancelScheduledFlush();
	state.flushTimer = setTimeout(() => {
		state.flushTimer = null;
		flushAtomicReport();
	}, delay);
}

function statsElapsedUs(stats?: WasmAtomicStats, fallbackMs = 0) {
	if (typeof stats?.elapsed_us === "number" && stats.elapsed_us > 0) {
		return stats.elapsed_us;
	}
	return Math.round(fallbackMs * 1000);
}

export {
	REPORT_ENV,
	resolveReportMode,
	isReportEnabled,
	configureAtomicReport,
	markBundlerReport,
	resetAtomicReport,
	recordCssTransform,
	recordClassStringTransform,
	snapshotAtomicReport,
	formatAtomicReport,
	flushAtomicReport,
	scheduleReportFlush,
	scheduleBundlerFlush,
	classMapTotals,
	statsElapsedUs,
};

export type {ReportOption, WasmAtomicStats, AtomicReportSnapshot};
