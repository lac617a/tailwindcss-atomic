import type {Metadata} from "next";
import type {ReactNode} from "react";
import "./globals.css";

export const metadata: Metadata = {
	title: "Tailwind Atomic · Next.js 15",
	description:
		"Ejemplo de App Router donde las utilidades de Tailwind se reescriben a clases _twa(hex).",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: ReactNode;
}>) {
	return (
		<html lang="es" className="h-full" suppressHydrationWarning>
			<body className="min-h-full bg-zinc-950 text-zinc-50 antialiased">
				{children}
			</body>
		</html>
	);
}
