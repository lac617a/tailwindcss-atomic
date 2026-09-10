import postcss from "postcss";

import {ATOMIC_RUNTIME} from "../src/engine/constants";
import {applyAtomicCss, transformClassString} from "../src/engine/css";
import factory from "../src/engine/factory";
import postcssTailwindcssAtomic from "../src/adapters/postcss";
import {
	REPORT_ENV,
	classMapTotals,
	configureAtomicReport,
	formatAtomicReport,
	flushAtomicReport,
	resetAtomicReport,
	resolveReportMode,
	snapshotAtomicReport,
} from "../src/engine/report";

describe("atomic report", () => {
	afterEach(() => {
		delete process.env[REPORT_ENV];
		resetAtomicReport();
	});

	it("reads TAILWINDCSS_ATOMIC_REPORT from the environment", () => {
		expect(resolveReportMode()).toBe(false);
		process.env[REPORT_ENV] = "1";
		expect(resolveReportMode()).toBe("text");
		process.env[REPORT_ENV] = "json";
		expect(resolveReportMode()).toBe("json");
		configureAtomicReport(false);
		expect(resolveReportMode()).toBe(false);
	});

	it("counts shared hashes from the class map", () => {
		ATOMIC_RUNTIME.classMap["flex"] = "_aaaaaa";
		ATOMIC_RUNTIME.classMap["flex-row"] = "_aaaaaa _bbbbbb";
		ATOMIC_RUNTIME.classMap["__skip_warmup"] = "_skip";
		expect(classMapTotals(ATOMIC_RUNTIME.classMap)).toEqual({
			utilities: 2,
			atomicRules: 2,
			declarations: 3,
			sharedHashes: 1,
		});
	});

	it("records CSS and class-string deltas when report is on", () => {
		configureAtomicReport(true);
		const {changed} = applyAtomicCss(".flex { display: flex } .p-4 { padding: 1rem }");
		expect(changed).toBe(true);
		transformClassString("flex p-4", ATOMIC_RUNTIME.classMap);

		const snapshot = snapshotAtomicReport();
		expect(snapshot).not.toBeNull();
		expect(snapshot?.css.beforeBytes).toBeGreaterThan(0);
		expect(snapshot?.css.afterBytes).toBeGreaterThan(0);
		expect(snapshot?.css.beforeGzip).toBeGreaterThan(0);
		expect(snapshot?.utilities).toBeGreaterThanOrEqual(2);
		expect(snapshot?.classStrings.beforeBytes).toBeGreaterThan(0);
		expect(snapshot?.classStrings.afterBytes).toBeGreaterThan(0);

		const text = formatAtomicReport(snapshot!);
		expect(text).toContain("[tailwindcss-atomic] report");
		expect(text).toContain("CSS");
		expect(text).toContain("atomic rules");
	});

	it("prints a json line from the bundler close hook", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const plugin = factory({report: "json"}) as {
			closeBundle: () => void;
			transform: (code: string, id: string) => Promise<unknown>;
		};

		await plugin.transform(".flex { display: flex }", "src/app.css");
		plugin.closeBundle();

		expect(log).toHaveBeenCalled();
		const printed = String(log.mock.calls[0]?.[0]);
		expect(printed).toContain("[tailwindcss-atomic] report");
		expect(printed).toContain('"css"');
		log.mockRestore();
	});

	it("does not print from PostCSS when a bundler plugin is attached", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		factory({report: true});
		await postcss([postcssTailwindcssAtomic()]).process(
			".flex { display: flex }",
			{from: "src/app.css"},
		);
		expect(log).not.toHaveBeenCalled();
		log.mockRestore();
	});

	it("prints after a PostCSS run when no bundler plugin is attached", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		resetAtomicReport();
		configureAtomicReport(true);

		await postcss([postcssTailwindcssAtomic({report: true})]).process(
			".flex { display: flex }",
			{from: "src/app.css"},
		);
		flushAtomicReport();

		expect(log).toHaveBeenCalled();
		expect(String(log.mock.calls[0]?.[0])).toContain("CSS");
		log.mockRestore();
	});

	it("does not print when report is off", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		applyAtomicCss(".flex { display: flex }");
		flushAtomicReport();
		expect(log).not.toHaveBeenCalled();
		log.mockRestore();
	});
});
