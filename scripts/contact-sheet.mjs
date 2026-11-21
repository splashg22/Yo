// Lays screenshots from shots/ out on one sheet: node scripts/contact-sheet.mjs out.png cols width file...
import { join } from "node:path";
import sharp from "sharp";
const [out, cols, width, ...files] = process.argv.slice(2);
const w = Number(width),
  c = Number(cols),
  gap = 10;
const tiles = await Promise.all(files.map((f) => sharp(join("shots", f)).resize({ width: w }).toBuffer({ resolveWithObject: true })));
const h = Math.max(...tiles.map((t) => t.info.height));
const rows = Math.ceil(tiles.length / c);
await sharp({ create: { width: c * (w + gap) + gap, height: rows * (h + gap) + gap, channels: 3, background: "#3a3a3a" } })
  .composite(tiles.map((t, i) => ({ input: t.data, left: gap + (i % c) * (w + gap), top: gap + Math.floor(i / c) * (h + gap) })))
  .png()
  .toFile(out);
