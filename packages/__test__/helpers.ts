export type TailwindCssResult = {
	class_map: Record<string, string>;
	css_rules: unknown;
	css?: string;
	changed?: boolean;
};

export function defaultProcessTailwindCss(css: string): TailwindCssResult {
	const class_map: Record<string, string> = Object.create(null);
	const css_rules: string[] = [];
	const ruleRe = /([^{]+)\{([^}]*)\}/g;

	for (const match of css.matchAll(ruleRe)) {
		const selector = match[1]?.trim() ?? "";
		const decls = match[2]?.trim() ?? "";
		if (!selector || !decls) continue;

		let nextSelector = selector;
		for (const classMatch of selector.matchAll(
			/\.((?:\\.|[^\s.:#[\]>+~,])+)/g,
		)) {
			const raw = classMatch[1];
			if (!raw) continue;
			const key = raw.replace(/\\/g, "");
			if (!class_map[key]) {
				let hash = 2166136261;
				for (let i = 0; i < key.length; i++) {
					hash ^= key.charCodeAt(i);
					hash = Math.imul(hash, 16777619);
				}
				class_map[key] =
					`_${(hash >>> 0).toString(16).padStart(8, "0").slice(0, 6)}`;
			}
			const hashed = class_map[key];
			if (hashed) {
				nextSelector = nextSelector.replace(classMatch[0], `.${hashed}`);
			}
		}

		css_rules.push(`${nextSelector} { ${decls} }`);
	}

	return {class_map, css_rules};
}

export const wasmMock = {
	impl: defaultProcessTailwindCss,
};

export function processTailwindCss(css: string): TailwindCssResult {
	return wasmMock.impl(css);
}
