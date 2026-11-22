// Is the working theme sharp? Measured, in a real browser, at 1, 2 and 3 device pixels to the pixel, on the board and
// a coin page of a server playing a recording (npm run replay). Run: npm run check:sharp
//
// What is measured:
//   - no picture is drawn larger than the file it came from (so nothing is stretched or soft);
//   - every panel, row, control and picture starts and ends on a whole device pixel (so no edge is smeared across two);
//   - every line that is drawn is a whole number of device pixels thick, and all lines of a kind are the same;
//   - each kind of thing has one corner radius;
//   - the right edges of the figures in a column of rows line up to the pixel.
// It writes close-up crops for a person to look at, to SHARP_OUT (default .data-shots/sharp).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const sharp = require("sharp");
const base = process.env.CHECK_URL ?? "http://127.0.0.1:4730";
const out = process.env.SHARP_OUT ?? ".data-shots/sharp";
const style = process.env.STYLE ?? "soft";
mkdirSync(out, { recursive: true });
const results = [];
const check = (name, passed, detail = "") => {
  results.push(passed);
  console.log(`${passed ? "pass" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const cookies = [
  ["ring-theme", process.env.THEME ?? "dark"],
  ["ring-style", style],
].map(([name, value]) => ({ name, value, url: base }));
const top = (await (await fetch(`${base}/api/trending`, { method: "POST", body: '{"window":"h1"}' })).json()).coins.find(
  (coin) => !coin.unsupported && coin.name,
);
const browser = await chromium.launch();
const crops = [];
for (const scale of [1, 2, 3]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale });
  await context.addCookies(cookies);
  const page = await context.newPage();
  for (const [name, path] of [
    ["board", "/terminal"],
    ["coin", `/coin/${top.mint}`],
  ]) {
    await page.goto(base + path);
    await page.waitForSelector(name === "board" ? ".coin-row" : "[data-checks] dl", { timeout: 30000 });
    await page.waitForTimeout(4000);
    const found = await page.evaluate((dpr) => {
      const whole = (value) => Math.abs(value * dpr - Math.round(value * dpr)) < 0.02;
      const out = { stretched: [], offGrid: [], lines: {}, radii: {}, columns: [] };
      for (const image of document.querySelectorAll("img")) {
        if (!image.complete || image.naturalWidth === 0 || getComputedStyle(image).opacity === "0") continue;
        const box = image.getBoundingClientRect();
        if (box.width === 0) continue;
        // A picture chosen from a set by density reports its width divided by that density: the file's own width is in its address.
        const file = Number(/[?&]w=(\d+)/.exec(image.currentSrc)?.[1] ?? image.naturalWidth);
        if (file < Math.round(box.width * dpr) - 1) out.stretched.push(`${file}px file drawn at ${Math.round(box.width * dpr)} device px`);
      }
      const KINDS = {
        panel: ".board-col, .card, .feed, .chart-box",
        row: ".coin-row, .vrow",
        control: ".btn, .quick, .field-row, .seg, .seg button",
        picture: ".coin-picture",
        tag: ".tag",
      };
      for (const [kind, selector] of Object.entries(KINDS)) {
        for (const element of document.querySelectorAll(selector)) {
          const box = element.getBoundingClientRect();
          if (box.width === 0 || box.bottom < 0 || box.top > innerHeight) continue;
          // A control or a tag is as wide as its words, and words are not a whole number of pixels wide in any typeface:
          // what is held to the grid for those is where they start and how tall they are.
          const fitted = kind === "control" || kind === "tag";
          if (!(fitted ? [box.top, box.height] : [box.left, box.top, box.width, box.height]).every(whole))
            out.offGrid.push(`${kind} at ${box.left.toFixed(2)},${box.top.toFixed(2)} size ${box.width.toFixed(2)} x ${box.height.toFixed(2)}`);
          const computed = getComputedStyle(element);
          for (const side of ["Top", "Right", "Bottom", "Left"]) {
            const width = parseFloat(computed[`border${side}Width`]);
            if (width > 0 && computed[`border${side}Style`] !== "none") (out.lines[kind] ??= new Set()).add(Math.round(width * dpr * 100) / 100);
          }
          if (kind !== "row") (out.radii[kind] ??= new Set()).add(computed.borderTopLeftRadius);
        }
      }
      for (const column of document.querySelectorAll(".board-col")) {
        const rights = [...column.querySelectorAll(".coin-row .nums")]
          .filter((cell) => cell.textContent.trim())
          .map((cell) => cell.getBoundingClientRect().right);
        if (rights.length > 2) out.columns.push(Math.max(...rights) - Math.min(...rights));
      }
      return {
        ...out,
        lines: Object.fromEntries(Object.entries(out.lines).map(([kind, set]) => [kind, [...set]])),
        radii: Object.fromEntries(Object.entries(out.radii).map(([kind, set]) => [kind, [...set]])),
      };
    }, scale);
    const at = `${name} at ${scale}x`;
    check(`${at}: no picture is drawn larger than its file`, found.stretched.length === 0, found.stretched[0] ?? "");
    check(
      `${at}: every panel, row, control and picture sits on whole device pixels`,
      found.offGrid.length === 0,
      `${found.offGrid.length} off: ${found.offGrid[0] ?? ""}`,
    );
    const lines = Object.entries(found.lines);
    check(
      `${at}: every line is a whole number of device pixels, and one thickness per kind`,
      lines.every(([, widths]) => widths.length === 1 && Number.isInteger(widths[0])),
      lines.map(([kind, widths]) => `${kind} ${widths.join("/")}`).join(", "),
    );
    const radii = Object.entries(found.radii);
    check(
      `${at}: one corner radius per kind`,
      radii.every(([kind, values]) => values.length === 1 || kind === "control"),
      radii.map(([kind, values]) => `${kind} ${values.join("/")}`).join(", "),
    );
    if (name === "board")
      check(
        `${at}: figures in a column end on the same pixel`,
        found.columns.every((spread) => spread < 0.01),
        `spread ${found.columns.map((spread) => spread.toFixed(2)).join(", ")} px`,
      );
    // A close-up: the same 300 by 150 CSS pixels at each density, enlarged without smoothing so every device pixel shows.
    const target = name === "board" ? page.locator(".board-col").first().locator(".coin-row").nth(1) : page.locator(".figures").first();
    const box = await target.boundingBox();
    if (box) {
      const clip = { x: Math.round(box.x), y: Math.round(box.y), width: 300, height: Math.min(150, Math.round(box.height)) };
      const file = `${out}/${name}-${scale}x.png`;
      await page.screenshot({ path: file, clip });
      crops.push({ name, scale, file });
    }
  }
  await context.close();
}
await browser.close();
// The crops of each screen side by side, all brought to the same size by repeating pixels, never by smoothing.
for (const name of ["board", "coin"]) {
  const mine = crops.filter((crop) => crop.name === name);
  const layers = [];
  let left = 20;
  let height = 0;
  for (const crop of mine) {
    const meta = await sharp(crop.file).metadata();
    const factor = 6 / crop.scale;
    const image = await sharp(crop.file)
      .resize({ width: meta.width * factor, kernel: "nearest" })
      .png()
      .toBuffer();
    const sized = await sharp(image).metadata();
    layers.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="40"><text x="0" y="28" font-family="sans-serif" font-size="22" font-weight="700" fill="#111">${crop.scale}x: each device pixel shown ${factor} times</text></svg>`,
      ),
      left,
      top: 10,
    });
    layers.push({ input: image, left, top: 54 });
    left += sized.width + 20;
    height = Math.max(height, sized.height + 74);
  }
  await sharp({ create: { width: left, height, channels: 3, background: "#d9dce1" } })
    .composite(layers)
    .png()
    .toFile(`${out}/closeup-${name}.png`);
}
const failed = results.filter((passed) => !passed).length;
console.log(`\n${results.length - failed} of ${results.length} passed. Close-ups in ${out}`);
process.exit(failed ? 1 : 0);
