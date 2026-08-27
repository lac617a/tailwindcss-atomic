import Head from "next/head";
import {useState} from "react";
import {cn} from "../lib/cn";

export default function HomePage() {
	const [on, setOn] = useState(true);

	return (
		<>
			<Head>
				<title>Tailwind Atomic · Next.js 12</title>
			</Head>
			<main className="mx-auto flex min-h-full max-w-3xl flex-col gap-8 px-6 py-16">
				<header className="flex flex-col gap-3 border-8 border-red-500">
					<p className="text-sm font-medium tracking-wide text-sky-400">
						Next.js 12 · Pages Router · Tailwind CSS 3
					</p>
					<h1 className="text-4xl font-semibold tracking-tight text-white">
						Tailwind Atomic
					</h1>
					<p className="max-w-xl text-base leading-7 text-red-400">
						Webpack 5 + PostCSS. Inspecciona el DOM: hashes `_` + 6
						hex, no `flex` ni `bg-zinc-950`.
					</p>
				</header>
				<section className="grid gap-4 md:grid-cols-2">
					<article className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
						<h2 className="text-lg font-medium text-white">
							className estático
						</h2>
						<p className="text-sm leading-6 text-zinc-400">
							`withTailwindAtomic` inyecta el loader y el plugin de
							Webpack.
						</p>
					</article>
					<article className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
						<h2 className="text-lg font-medium text-white">
							cn() dinámico
						</h2>
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
			</main>
		</>
	);
}
