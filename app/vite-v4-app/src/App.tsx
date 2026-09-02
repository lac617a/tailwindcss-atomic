import {useState} from "react";
import {cn} from "./cn";

export default function App() {
	const [on, setOn] = useState(true);

	return (
		<div className="min-h-full bg-zinc-950 text-zinc-50 antialiased">
			<main className="mx-auto flex min-h-full max-w-3xl flex-col gap-8 px-6 py-16">
				<header className="flex flex-col gap-3 border-8 border-red-500">
					<p className="text-sm font-medium tracking-wide text-sky-400">
						Vite · Tailwind CSS 4
					</p>
					<h1 className="text-4xl font-semibold tracking-tight text-white">
						Tailwind Atomic
					</h1>
					<p className="max-w-xl text-base leading-7 text-red-400">
						Inspecciona el DOM: las utilidades (`flex`, `bg-zinc-950`)
						deben ser hashes `_` + 6 hex. El CSS usa{" "}
						<code className="rounded bg-zinc-900 px-1.5 py-0.5 text-sky-300">
							@import &quot;tailwindcss&quot;
						</code>{" "}
						y{" "}
						<code className="rounded bg-zinc-900 px-1.5 py-0.5 text-sky-300">
							@theme
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
							PostCSS (`@tailwindcss/postcss`) expande v4; atomic
							parte cada declaración. El plugin de Vite reescribe el
							JSX.
						</p>
						<div className="flex gap-2">
							<span className="rounded-lg bg-sky-500 px-3 py-1 text-xs font-semibold text-sky-950">
								p-6
							</span>
							<span className="rounded-lg bg-violet-500 px-3 py-1 text-xs font-semibold text-violet-950">
								@theme
							</span>
						</div>
					</article>

					<article className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
						<h2 className="text-lg font-medium text-white">
							cn() dinámico
						</h2>
						<p className="text-sm leading-6 text-zinc-400">
							También se reescriben strings dentro de{" "}
							<code className="text-sky-300">cn</code>.
						</p>
						<button
							type="button"
							onClick={() => setOn((value) => !value)}
							className={cn(
								"rounded-full px-4 py-2 text-sm font-medium transition-colors",
								on
									? "bg-emerald-400 text-emerald-950"
									: "bg-zinc-800 text-zinc-400",
							)}
						>
							cn() · {on ? "activo" : "inactivo"}
						</button>
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
		</div>
	);
}
