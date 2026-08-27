import {transformClassString} from "../shared/css";
import type {
	ObjectExpression,
	TemplateLiteral,
	Expression,
	SpreadElement,
	JSXEmptyExpression,
	ArgumentPlaceholder,
} from "@babel/types";

type ProcessableNode =
	| Expression
	| SpreadElement
	| JSXEmptyExpression
	| ArgumentPlaceholder
	| null
	| undefined;

let modified = false;

function processTemplateLiteral(
	templateLiteral: TemplateLiteral,
	classMap: Record<string, string>,
) {
	templateLiteral.quasis.forEach((element) => {
		if (element.value && element.value.raw) {
			element.value.raw = transformClassString(element.value.raw, classMap);
			if (element.value.cooked != null) {
				element.value.cooked = transformClassString(
					element.value.cooked,
					classMap,
				);
			}
			modified = true;
		}
	});

	return modified;
}

function processObjectExpression(
	objectExpression: ObjectExpression,
	classMap: Record<string, string>,
) {
	objectExpression.properties.forEach((property) => {
		if (property.type === "ObjectProperty") {
			if (property.key.type === "StringLiteral") {
				property.key.value = transformClassString(property.key.value, classMap);
				modified = true;
			} else if (property.key.type === "Identifier" && !property.computed) {
				property.key.name = transformClassString(property.key.name, classMap);
				modified = true;
			}
		}
	});
	return modified;
}

export function processArgument(
	argNode: ProcessableNode,
	classMap: Record<string, string>,
): boolean {
	if (!argNode) return false;

	switch (argNode.type) {
		case "StringLiteral":
			argNode.value = transformClassString(argNode.value, classMap);
			return true;
		case "TemplateLiteral":
			return processTemplateLiteral(argNode, classMap);
		case "ObjectExpression":
			return processObjectExpression(argNode, classMap);
		case "ArrayExpression":
			argNode.elements.forEach((el) => {
				if (processArgument(el, classMap)) modified = true;
			});
			return modified;
		case "ConditionalExpression": {
			const altMod = processArgument(argNode.alternate, classMap);
			const consMod = processArgument(argNode.consequent, classMap);
			return altMod || consMod;
		}
		case "LogicalExpression":
			return processArgument(argNode.right, classMap);
		default:
			return false;
	}
}
