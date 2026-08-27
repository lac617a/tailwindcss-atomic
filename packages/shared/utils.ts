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
	const dir =
		typeof __dirname === "string"
			? __dirname
			: path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(dir, "..", "loader.js");
}

export {getCalleeName, resolveWebpackLoaderPath};
