// One frame as PNG.   node still.mjs --frame 700 [--scale 2] [--out out/thumbnail.png]
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const frames = arg("frame", "700").split(",").map(Number);
const scale = Number(arg("scale", "2"));
const outArg = arg("out", null);
mkdirSync(join(here, "out"), { recursive: true });
const serveUrl = await bundle({ entryPoint: join(here, "src", "index.tsx"), publicDir: join(here, "public") });
const composition = await selectComposition({ serveUrl, id: "Walkthrough" });
for (const frame of frames) {
  const out = outArg && frames.length === 1 ? outArg : join(here, "out", `frame-${String(frame).padStart(4, "0")}.png`);
  await renderStill({ composition, serveUrl, output: out, frame, scale, imageFormat: "png", chromiumOptions: { gl: "angle" }, onBrowserLog: (l) => console.log("[browser]", l.type, l.text.slice(0, 600)), timeoutInMilliseconds: 180000 });
  console.log("wrote", out);
}
