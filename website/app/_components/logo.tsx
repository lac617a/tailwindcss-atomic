export function Logo() {
	return (
		<span className="flex items-center gap-2 font-semibold tracking-tight">
			<svg
				aria-hidden="true"
				className="size-7"
				fill="none"
				viewBox="0 0 32 32"
			>
				<rect
					className="fill-sky-500/15 stroke-sky-500"
					height="28"
					rx="8"
					width="28"
					x="2"
					y="2"
					strokeWidth="1.5"
				/>
				<path
					className="stroke-sky-500"
					d="M10 12h12M10 16h8M10 20h10"
					strokeLinecap="round"
					strokeWidth="2"
				/>
				<circle className="fill-violet-500" cx="22" cy="16" r="2.2" />
			</svg>
			tailwindcss-atomic
		</span>
	);
}
