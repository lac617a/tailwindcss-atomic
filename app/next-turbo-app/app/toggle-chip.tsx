"use client";

import {useState} from "react";
import {cn} from "@/lib/cn";

export function ToggleChip() {
	const [on, setOn] = useState(true);

	return (
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
	);
}
