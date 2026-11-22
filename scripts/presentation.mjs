// Presentation shots of the real product, for the homepage and for posts: the actual board and coin page, as a real
// browser drew them from real data, shown inside a plain device frame at an angle on a dark studio background.
// Exported at 4K (3840 x 2160). Nothing on the screens is drawn or retouched; only the frame and the room are.
//
//   npm run build && npm run replay -- <recording>      (or any running server: SHOTS_URL)
//   npm run shots                                       writes to .data-shots/presentation (SHOTS_OUT)
//   STYLE=soft|playful|plain|current  THEME=dark|light  choose the look of the screens (default: soft, dark)
//
// What is on the screens is whatever the server shows: against a recording, the bar that says so is in the shot.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.env.SHOTS_URL ?? "http://127.0.0.1:4730";
const out = process.env.SHOTS_OUT ?? ".data-shots/presentation";
const style = process.env.STYLE ?? "soft";
const theme = process.env.THEME ?? "dark";
mkdirSync(out, { recursive: true });
const cookies =
  style === "current"
    ? []
    : [["ring-work-theme", "preview"], ["ring-theme", theme], ...(style === "plain" ? [] : [["ring-style", style]])].map(([name, value]) => ({
        name,
        value,
        url: base,
      }));
const browser = await chromium.launch();

// ---- 1. the real screens, at two and three device pixels to the pixel ----
const top = (await (await fetch(`${base}/api/trending`, { method: "POST", body: '{"window":"h1"}' })).json()).coins.find(
  (coin) => !coin.unsupported && coin.name && !coin.venue,
);
async function screen(name, path, viewport, scale, ready) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale });
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.goto(base + path);
  await page.waitForSelector(ready, { timeout: 30000 });
  await page.waitForTimeout(6000);
  const file = `${out}/screen-${name}.png`;
  await page.screenshot({ path: file });
  await context.close();
  return file;
}
const board = await screen("board", "/terminal", { width: 1440, height: 900 }, 2, ".coin-row");
const coin = await screen("coin", `/coin/${top.mint}`, { width: 1440, height: 900 }, 2, ".chart-area canvas");
const phone = await screen("board-phone", "/terminal", { width: 390, height: 844 }, 3, ".coin-row");
const uri = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;

// ---- 2. the room and the frame: a page of its own, photographed at 4K ----
const room = (devices) => `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #08090b; }
  /* the studio: light falling off from above, and a floor that the frame's shadow lands on */
  .room { position: absolute; inset: 0; background: linear-gradient(180deg, #17191e 0%, #0d0e11 46%, #08090b 100%); perspective: 2600px; perspective-origin: 50% 42%; }
  .device { position: absolute; transform-style: preserve-3d; }
  .frame { background: #0b0c0e; border: 1px solid #2c3038; box-shadow: 0 60px 90px rgba(0, 0, 0, 0.62), 0 0 0 1px #050506; }
  .frame img { display: block; width: 100%; height: auto; }
  .display .frame { padding: 14px; border-radius: 22px; }
  .display .frame img { border-radius: 8px; }
  .handset .frame { padding: 10px; border-radius: 46px; }
  .handset .frame img { border-radius: 36px; }
</style><div class="room">${devices}</div>`;
const SHOTS = {
  board: `<div class="device display" style="left: 250px; top: 96px; width: 1420px; transform: rotateY(-17deg) rotateX(7deg) rotateZ(1.2deg);"><div class="frame"><img src="${uri(board)}"></div></div>`,
  coin: `<div class="device display" style="left: 250px; top: 96px; width: 1420px; transform: rotateY(17deg) rotateX(7deg) rotateZ(-1.2deg);"><div class="frame"><img src="${uri(coin)}"></div></div>`,
  both: `<div class="device display" style="left: 120px; top: 130px; width: 1300px; transform: rotateY(-14deg) rotateX(6deg) rotateZ(1deg);"><div class="frame"><img src="${uri(coin)}"></div></div>
         <div class="device handset" style="left: 1370px; top: 150px; width: 380px; transform: rotateY(-20deg) rotateX(5deg) rotateZ(1.5deg) translateZ(160px);"><div class="frame"><img src="${uri(phone)}"></div></div>`,
};
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const page = await context.newPage();
for (const [name, devices] of Object.entries(SHOTS)) {
  await page.setContent(room(devices));
  await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/ringpad-${name}-4k.png` });
  console.log(`${out}/ringpad-${name}-4k.png  3840 x 2160`);
}
await browser.close();
