// Copies the site's own assets (logo, ring and cycle artwork) into public/site so the composition
// always uses what the website ships. ui.css is imported straight from web/ by the bundler.
import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "..", "web");
const out = join(here, "public", "site");
mkdirSync(join(out, "art"), { recursive: true });
cpSync(join(web, "logo.svg"), join(out, "logo.svg"));
cpSync(join(web, "art", "ring"), join(out, "art", "ring"), { recursive: true });
cpSync(join(web, "art", "cycle"), join(out, "art", "cycle"), { recursive: true });
const kit = join(here, "..", "kit", "logo");
mkdirSync(join(out, "kit"), { recursive: true });
for (const f of ["mark.svg", "wordmark-on-dark.svg", "lockup-on-dark.svg"]) cpSync(join(kit, f), join(out, "kit", f));
console.log("site assets and kit logos copied to public/site");
