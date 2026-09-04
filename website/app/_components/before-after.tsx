type BeforeAfterProps = {
	beforeLabel: string;
	afterLabel: string;
};

const before = `<div class="flex p-6">

.flex { display: flex; }
.p-6  { padding: 1.5rem; }`;

const after = `<div class="_215464 _69df78">

._215464 { display: flex; }
._69df78 { padding: 1.5rem; }`;

export function BeforeAfter({beforeLabel, afterLabel}: BeforeAfterProps) {
	return (
		<div className="not-prose my-8 grid gap-4 md:grid-cols-2">
			<figure className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
				<figcaption className="border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
					{beforeLabel}
				</figcaption>
				<pre className="overflow-x-auto p-4 text-[13px] leading-6">
					<code>{before}</code>
				</pre>
			</figure>
			<figure className="overflow-hidden rounded-xl border border-sky-500/30 bg-sky-500/5">
				<figcaption className="border-b border-sky-500/20 bg-sky-500/10 px-4 py-2 text-xs font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">
					{afterLabel}
				</figcaption>
				<pre className="overflow-x-auto p-4 text-[13px] leading-6">
					<code>{after}</code>
				</pre>
			</figure>
		</div>
	);
}
