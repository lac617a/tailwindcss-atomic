import {copyFileSync, mkdirSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

mkdirSync(dist, {recursive: true});

for (const name of ["index", "next", "postcss"]) {
	copyFileSync(join(root, "packages", `${name}.d.ts`), join(dist, `${name}.d.ts`));
}
