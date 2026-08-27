import {transformClassString} from "../shared/utils";

let modified = false;

function processTemplateLiteral(templateLiteral, classMap) {
	templateLiteral.quasis.forEach((element) => {
		if (element.value && element.value.raw) {
			element.value.raw = transformClassString(element.value.raw, classMap);
			element.value.cooked = transformClassString(
				element.value.cooked,
				classMap,
			);
			modified = true;
		}
	});

	return modified;
}

function processObjectExpression(objectExpression, classMap) {
	objectExpression.properties.forEach((property) => {
		if (property.type === "ObjectProperty") {
			if (property.key.type === "StringLiteral") {
				prop.key.value = transformClassString(prop.key.value, classMap);
				modified = true;
			} else if (prop.key.type === "Identifier" && !prop.computed) {
				prop.key.name = transformClassString(prop.key.name, classMap);
				modified = true;
			}
		}
	});
	return modified;
}

export function processArgument(argNode, classMap) {
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
		case "ConditionalExpression":
			const altMod = processArgument(argNode.alternate, classMap);
			const consMod = processArgument(argNode.consequent, classMap);
			return altMod || consMod;
		case "LogicalExpression":
			return processArgument(argNode.right, classMap);
		default:
			return false;
	}
}
