// Draws the stand-in brand media: hero.png, layers.png, hero.mp4, logo.png, banner.png.
// These are placeholders with the exact names and sizes brand/README.md asks for, so the
// real renders can replace them with no code changes. Run: npm run standins
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brand = join(root, "brand");
const { chromium } = createRequire(import.meta.url)("playwright");

const ACCENT = [0.961, 0.647, 0.141]; // #F5A524
/** Where the object sits in the video frames: its centre, as a share of the frame width. */
const OBJECT_X = 0.64;
/** How large the object is drawn. The same in every frame: the camera is locked. */
const ZOOM = 1.22;
const FRAMES = 144; // 6 seconds at 24 frames per second
const only = process.argv[2]; // optional: "stills" or "video"

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage();
page.on("pageerror", (error) => {
  console.error(String(error));
  process.exit(1);
});
await page.goto(`file://${join(root, "scripts", "standin-scene.html")}`);
await page.waitForFunction("window.ready === true");

/** shift is in units of half the frame height, so convert from a share of the width. */
const shiftFor = (x, width, height) => ((x - 0.5) * 2 * width) / height;
async function render(options) {
  const url = await page.evaluate((o) => window.render(o), { accent: ACCENT, zoom: ZOOM, ...options });
  return Buffer.from(url.split(",")[1], "base64");
}

if (only !== "video") {
  const big = { width: 3840, height: 2160 };
  writeFileSync(join(brand, "hero.png"), await render({ ...big, t: 0, shift: shiftFor(OBJECT_X, 3840, 2160) }));
  console.log("hero.png");
  writeFileSync(join(brand, "layers.png"), await render({ ...big, t: 1, shift: 0 }));
  console.log("layers.png");
  // Banner: the ring large and running off the right edge, left half empty.
  writeFileSync(join(brand, "banner.png"), await render({ width: 3600, height: 1200, t: 0, shift: shiftFor(0.86, 3600, 1200), zoom: 2.4 }));
  console.log("banner.png");
  await sharp(readFileSync(join(root, "public", "logo.svg")), { density: 600 })
    .resize(2048, 2048, { fit: "contain", background: "#000000" })
    .flatten({ background: "#000000" })
    .png()
    .toFile(join(brand, "logo.png"));
  console.log("logo.png");
}

if (only !== "stills") {
  const frames = mkdtempSync(join(tmpdir(), "ringpad-frames-"));
  for (let i = 0; i < FRAMES; i++) {
    const png = await render({ width: 1920, height: 1080, t: i / (FRAMES - 1), shift: shiftFor(OBJECT_X, 1920, 1080) });
    writeFileSync(join(frames, `f_${String(i).padStart(4, "0")}.png`), png);
    if (i % 12 === 0) console.log(`frame ${i + 1} of ${FRAMES}`);
  }
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    "24",
    "-i",
    join(frames, "f_%04d.png"),
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "14",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    join(brand, "hero.mp4"),
  ]);
  rmSync(frames, { recursive: true });
  console.log("hero.mp4");
}
await browser.close();
