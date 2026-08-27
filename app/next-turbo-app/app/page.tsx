import {ToggleChip} from "./toggle-chip";

export default function HomePage() {
	return (
		<main className="mx-auto flex min-h-full max-w-3xl flex-col gap-8 px-6 py-16">
			<header className="flex flex-col gap-3 border-8 border-red-500">
				<p className="text-sm font-medium tracking-wide text-sky-400">
					Next.js 15 · App Router · Turbopack
				</p>
				<h1 className="text-4xl font-semibold tracking-tight text-white">
					Tailwind Atomic
				</h1>
				<p className="max-w-xl text-base leading-7 text-red-400">
					Arranca con `next dev --turbopack`. Inspecciona el DOM: hashes
					`_` + 6 hex, no `flex` ni `bg-zinc-950`.
				</p>
			</header>
			<section className="grid gap-4 md:grid-cols-2">
				<article className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
					<h2 className="text-lg font-medium text-white">
						className estático
					</h2>
					<p className="text-sm leading-6 text-zinc-400">
						PostCSS atomiciza el CSS. `withTailwindAtomic` registra el
						loader también en `turbopack.rules`.
					</p>
				</article>
				<article className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
					<h2 className="text-lg font-medium text-white">cn() dinámico</h2>
					<ToggleChip />
				</article>
			</section>
		</main>
	);
}
