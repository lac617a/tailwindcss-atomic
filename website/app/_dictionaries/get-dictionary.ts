import type {Dictionaries, Dictionary, Locale} from "./i18n-config";
import "server-only";

const dictionaries: Dictionaries = {
	en: () => import("./en"),
	es: () => import("./es"),
};

export async function getDictionary(locale: string): Promise<Dictionary> {
	const loader = dictionaries[locale as Locale] ?? dictionaries.en;
	const {default: dictionary} = await loader();
	return dictionary;
}

export function getDirection(_locale: Locale): "ltr" | "rtl" {
	return "ltr";
}
