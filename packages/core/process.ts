import {transformClassString} from "../shared/css";
import type {
	CallExpression,
	ObjectExpression,
	ObjectProperty,
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

function getStaticPropertyKey(property: ObjectProperty): string | undefined {
	if (property.computed) return undefined;
	if (property.key.type === "Identifier") return property.key.name;
	if (property.key.type === "StringLiteral") return property.key.value;
	return undefined;
}

function processObjectExpression(
	objectExpression: ObjectExpression,
	classMap: Record<string, string>,
	rewriteKeys: boolean,
) {
	objectExpression.properties.forEach((property) => {
		if (property.type !== "ObjectProperty" || !rewriteKeys) return;

		if (property.key.type === "StringLiteral") {
			property.key.value = transformClassString(property.key.value, classMap);
			modified = true;
		} else if (property.key.type === "Identifier" && !property.computed) {
			property.key.name = transformClassString(property.key.name, classMap);
			modified = true;
		}
	});
	return modified;
}

function processClassValue(
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
		case "ArrayExpression":
			argNode.elements.forEach((el) => {
				if (processClassValue(el, classMap)) modified = true;
			});
			return modified;
		case "ConditionalExpression": {
			const altMod = processClassValue(argNode.alternate, classMap);
			const consMod = processClassValue(argNode.consequent, classMap);
			return altMod || consMod;
		}
		case "LogicalExpression":
			return processClassValue(argNode.right, classMap);
		default:
			return false;
	}
}

function processCvaVariantOptions(
	node: ProcessableNode,
	classMap: Record<string, string>,
): boolean {
	if (!node || node.type !== "ObjectExpression") return false;
	let changed = false;
	for (const property of node.properties) {
		if (property.type !== "ObjectProperty") continue;
		if (processClassValue(property.value as ProcessableNode, classMap)) changed = true;
	}
	return changed;
}

function processCvaVariants(
	node: ProcessableNode,
	classMap: Record<string, string>,
): boolean {
	if (!node || node.type !== "ObjectExpression") return false;
	let changed = false;
	for (const property of node.properties) {
		if (property.type !== "ObjectProperty") continue;
		if (processCvaVariantOptions(property.value as ProcessableNode, classMap)) changed = true;
	}
	return changed;
}

function processCvaCompoundVariants(
	node: ProcessableNode,
	classMap: Record<string, string>,
): boolean {
	if (!node || node.type !== "ArrayExpression") return false;
	let changed = false;
	for (const element of node.elements) {
		if (!element || element.type !== "ObjectExpression") continue;
		for (const property of element.properties) {
			if (property.type !== "ObjectProperty") continue;
			const key = getStaticPropertyKey(property);
			if (key === "class" || key === "className") {
				if (processClassValue(property.value as ProcessableNode, classMap)) changed = true;
			}
		}
	}
	return changed;
}

function processCvaConfig(
	node: ProcessableNode,
	classMap: Record<string, string>,
): boolean {
	if (!node || node.type !== "ObjectExpression") return false;
	let changed = false;
	for (const property of node.properties) {
		if (property.type !== "ObjectProperty") continue;
		const key = getStaticPropertyKey(property);
		if (key === "variants") {
			if (processCvaVariants(property.value as ProcessableNode, classMap)) changed = true;
		} else if (key === "compoundVariants") {
			if (processCvaCompoundVariants(property.value as ProcessableNode, classMap)) changed = true;
		}
	}
	return changed;
}

export function processCvaCall(
	args: CallExpression["arguments"],
	classMap: Record<string, string>,
): boolean {
	let changed = false;
	if (processClassValue(args[0], classMap)) changed = true;
	if (processCvaConfig(args[1], classMap)) changed = true;
	return changed;
}

export function processArgument(
	argNode: ProcessableNode,
	classMap: Record<string, string>,
	rewriteObjectKeys = true,
): boolean {
	if (!argNode) return false;

	switch (argNode.type) {
		case "StringLiteral":
			argNode.value = transformClassString(argNode.value, classMap);
			return true;
		case "TemplateLiteral":
			return processTemplateLiteral(argNode, classMap);
		case "ObjectExpression":
			return processObjectExpression(argNode, classMap, rewriteObjectKeys);
		case "ArrayExpression":
			argNode.elements.forEach((el) => {
				if (processArgument(el, classMap, rewriteObjectKeys)) modified = true;
			});
			return modified;
		case "ConditionalExpression": {
			const altMod = processArgument(
				argNode.alternate,
				classMap,
				rewriteObjectKeys,
			);
			const consMod = processArgument(
				argNode.consequent,
				classMap,
				rewriteObjectKeys,
			);
			return altMod || consMod;
		}
		case "LogicalExpression":
			return processArgument(argNode.right, classMap, rewriteObjectKeys);
		default:
			return false;
	}
}
