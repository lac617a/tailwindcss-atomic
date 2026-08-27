import {Head, Html, Main, NextScript} from "next/document";

export default function Document() {
	return (
		<Html lang="es" className="h-full">
			<Head />
			<body className="min-h-full bg-zinc-950 text-zinc-50 antialiased">
				<Main />
				<NextScript />
			</body>
		</Html>
	);
}
