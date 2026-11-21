// Bundles the server (server/main.ts and everything under lib/server) into one file, dist/server.mjs.
// Packages stay outside the bundle and are loaded from node_modules at run time.
import { build } from "esbuild";

await build({
  entryPoints: ["server/main.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
  logLevel: "warning",
  alias: { "@": "." },
});
console.log("server bundled: dist/server.mjs");
