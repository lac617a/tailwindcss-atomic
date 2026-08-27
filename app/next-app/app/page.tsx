import {ToggleChip} from "./toggle-chip";

export default function HomePage() {
	return (
		<main className="mx-auto flex min-h-full max-w-3xl flex-col gap-8 px-6 py-16">
			<header className="flex flex-col gap-3 border-8 border-red-500">
				<p className="text-sm font-medium tracking-wide text-sky-400">
					Next.js 15 · App Router
				</p>
				<h1 className="text-4xl font-semibold tracking-tight text-white">
					Tailwind Atomic
				</h1>
				<p className="max-w-xl text-base leading-7 text-red-400">
					Inspecciona el DOM:{" "}
					<code className="rounded bg-zinc-900 px-1.5 py-0.5 text-sky-300">
						className
					</code>{" "}
					ya no debería tener{" "}
					<code className="rounded bg-zinc-900 px-1.5 py-0.5 text-sky-300">
						flex
					</code>{" "}
					ni{" "}
					<code className="rounded bg-zinc-900 px-1.5 py-0.5 text-sky-300">
						bg-zinc-950
					</code>
					, sino hashes{" "}
					<code className="rounded bg-zinc-900 px-1.5 py-0.5 text-sky-300">
						_…
					</code>
					.
				</p>
			</header>

			<section className="grid gap-4 md:grid-cols-2">
				<article className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
					<h2 className="text-lg font-medium text-white">
						className estático
					</h2>
					<p className="text-sm leading-6 text-zinc-400">
						Este card usa utilidades de Tailwind en el servidor. Tras
						el build, cada declaración CSS se vuelve una clase atómica.
					</p>
					<div className="flex gap-2">
						<span className="rounded-lg bg-sky-500 px-3 py-1 text-xs font-semibold text-sky-950">
							p-6
						</span>
						<span className="rounded-lg bg-violet-500 px-3 py-1 text-xs font-semibold text-violet-950">
							gap-3
						</span>
					</div>
				</article>

				<article className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
					<h2 className="text-lg font-medium text-white">
						cn() dinámico
					</h2>
					<p className="text-sm leading-6 text-zinc-400">
						El plugin también reescribe strings dentro de{" "}
						<code className="text-sky-300">cn</code>,{" "}
						<code className="text-sky-300">clsx</code> y{" "}
						<code className="text-sky-300">cva</code>.
					</p>
					<ToggleChip />
				</article>
			</section>

			<section className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-zinc-700 p-6">
				<button
					type="button"
					className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-950"
				>
					Primario
				</button>
				<button
					type="button"
					className="rounded-xl border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-100"
				>
					Secundario
				</button>
				<button
					type="button"
					className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white"
				>
					Danger
				</button>
			</section>
		</main>
	);
}
