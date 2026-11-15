// Copies the single-file studio into public/ so the site serves it at "/"
// (see the rewrite in next.config.mjs). The source of truth stays
// apps/studio/clipforge-studio.html, the standalone build of the studio.
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../../studio/clipforge-studio.html");
const dest = join(here, "../public/studio.html");

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`studio: copied ${statSync(dest).size} bytes to public/studio.html`);
