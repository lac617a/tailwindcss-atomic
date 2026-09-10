import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import type {CallExpression, Expression, PrivateName} from "@babel/types";

function getCalleeName(
	callee: CallExpression["callee"] | Expression | PrivateName | null | undefined,
): string | null {
	if (!callee) return null;

	switch (callee.type) {
		case "Identifier":
			return callee.name;
		case "MemberExpression": {
			const property = callee.property;
			if (property.type === "Identifier") return property.name;
			if (
				property.type === "StringLiteral" ||
				property.type === "NumericLiteral"
			) {
				return String(property.value);
			}
			return null;
		}
		case "SequenceExpression":
			return getCalleeName(callee.expressions.at(-1));
		default:
			return null;
	}
}

function resolveWebpackLoaderPath() {
	const start =
		typeof __dirname === "string"
			? __dirname
			: path.dirname(fileURLToPath(import.meta.url));
	let dir = start;
	for (let i = 0; i < 6; i++) {
		const here = path.resolve(dir, "loader.cjs");
		const dist = path.resolve(dir, "dist", "loader.cjs");
		if (existsSync(here)) return here;
		if (existsSync(dist)) return dist;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return path.resolve(start, "loader.cjs");
}

export {getCalleeName, resolveWebpackLoaderPath};
