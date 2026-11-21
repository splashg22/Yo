// Turns the files in brand/ into what the site serves: sized stills, the frame sequence
// cut from hero.mp4, and the link-preview image. Run after changing anything in brand/:
//   npm run media
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brand = join(root, "brand");
const out = join(root, "public", "media");
const FRAMES = 96;
const SEQUENCE_WIDTHS = [640, 1280, 1920];
const STILL_WIDTHS = [960, 1440, 1920, 2880];

for (const file of ["hero.png", "layers.png", "hero.mp4", "banner.png"]) {
  if (!existsSync(join(brand, file))) throw new Error(`brand/${file} is missing. See brand/README.md.`);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/**
 * The media sits on pure black. To let the site's background pass behind the object, the
 * black is turned into transparency: a pixel's opacity follows its brightness, and its
 * colour is scaled back up so that over a black page it looks exactly as it did.
 */
async function keyed(input, width) {
  const { data, info } = await sharp(input).resize({ width }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, o = 0; i < data.length; i += 3, o += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const alpha = Math.min(255, Math.max(r, g, b) * 10);
    const scale = alpha ? 255 / alpha : 0;
    rgba[o] = Math.min(255, r * scale);
    rgba[o + 1] = Math.min(255, g * scale);
    rgba[o + 2] = Math.min(255, b * scale);
    rgba[o + 3] = alpha;
  }
  return sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } });
}

for (const name of ["hero", "layers"]) {
  for (const width of STILL_WIDTHS) {
    await (await keyed(join(brand, `${name}.png`), width)).webp({ quality: 84, alphaQuality: 90 }).toFile(join(out, `${name}-${width}.webp`));
  }
}
// Link previews want 1200 x 630. The banner is 3:1, so keep its right side, where the object is.
await sharp(join(brand, "banner.png"))
  .resize({ height: 630 })
  .extract({ left: 1890 - 1200, top: 0, width: 1200, height: 630 })
  .png({ compressionLevel: 9 })
  .toFile(join(out, "og.png"));

// The scroll sequence: evenly spaced frames from the video, at three sizes.
const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(brand, "hero.mp4")]).toString());
const frames = mkdtempSync(join(tmpdir(), "ringpad-seq-"));
execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-i",
  join(brand, "hero.mp4"),
  "-vf",
  `fps=${(FRAMES / duration).toFixed(5)}`,
  "-frames:v",
  String(FRAMES),
  join(frames, "%03d.png"),
]);
const extracted = readdirSync(frames).sort();
for (const width of SEQUENCE_WIDTHS) {
  mkdirSync(join(out, "seq", String(width)), { recursive: true });
  await Promise.all(
    extracted.map(async (file, index) =>
      (await keyed(join(frames, file), width))
        .webp({ quality: width === 640 ? 64 : 72, alphaQuality: 80 })
        .toFile(join(out, "seq", String(width), `${String(index).padStart(3, "0")}.webp`)),
    ),
  );
}
rmSync(frames, { recursive: true });

writeFileSync(
  join(root, "lib", "media.json"),
  `${JSON.stringify({ frames: extracted.length, sequenceWidths: SEQUENCE_WIDTHS, stillWidths: STILL_WIDTHS }, null, 2)}\n`,
);
const size = (dir) => readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).length;
console.log(`${extracted.length} frames x ${SEQUENCE_WIDTHS.length} sizes, ${size(out)} files in public/media`);
