import {fileURLToPath} from "node:url";
import path from "node:path";

function getCalleeName(callee) {
	if (!callee) return null;

	switch (callee.type) {
		case "Identifier":
			return callee.name;
		case "MemberExpression":
			return callee.property.name || callee.property.value || null;
		case "SequenceExpression":
			return getCalleeName(callee.expressions[callee.expressions.length - 1]);
		default:
			return null;
	}
}

function resolveWebpackLoaderPath() {
	const dir =
		typeof __dirname === "string"
			? __dirname
			: path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(dir, "..", "webpack-loader.cjs");
}

export {getCalleeName, resolveWebpackLoaderPath};
