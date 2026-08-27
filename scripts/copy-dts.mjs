import {copyFileSync, mkdirSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..", "packages");
const dist = join(pkg, "dist");

mkdirSync(dist, {recursive: true});

for (const name of ["index", "next", "postcss"]) {
	copyFileSync(join(pkg, `${name}.d.ts`), join(dist, `${name}.d.ts`));
}
