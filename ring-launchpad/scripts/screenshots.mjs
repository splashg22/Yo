// Screenshots of every page at desktop and phone width, plus the homepage at each scroll
// step, and a check that the background stays dark behind text. Needs `npm run build` and
// a server on PORT (default 3311): npm run start -- -p 3311
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "shots");
mkdirSync(out, { recursive: true });
const { chromium } = createRequire(import.meta.url)("playwright");
const base = `http://127.0.0.1:${process.env.PORT ?? 3311}`;
const PAGES = ["/", "/explore", "/launch", "/wallet", "/otc", "/docs", "/terms", "/privacy"];
const SIZES = { desktop: { width: 1440, height: 900, deviceScaleFactor: 1 }, phone: { width: 390, height: 844, deviceScaleFactor: 2 } };

const browser = await chromium.launch();
const report = [];
for (const [device, size] of Object.entries(SIZES)) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.deviceScaleFactor });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  for (const path of PAGES) {
    await page.goto(base + path, { waitUntil: "load" });
    await page.waitForTimeout(2600); // the background starts after the page is idle
    const name = path === "/" ? "home" : path.slice(1);
    await page.screenshot({ path: join(out, `${name}-${device}.png`) });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    // Brightest background pixel directly behind any text on screen.
    const behind = await page.evaluate(() => {
      const canvas = document.querySelector("canvas.bg");
      const ctx = canvas.getContext("2d");
      const scale = canvas.width / innerWidth;
      let worst = 0;
      for (const el of document.querySelectorAll("h1, h2, h3, p, li, td, th, label, a, .label, dd, dt, input")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.bottom < 0 || r.top > innerHeight || getComputedStyle(el).visibility === "hidden") continue;
        const range = document.createRange(); range.selectNodeContents(el);
        for (const box of range.getClientRects()) {
          const x = Math.max(0, Math.floor(box.left * scale)), y = Math.max(0, Math.floor(box.top * scale));
          const w = Math.min(canvas.width - x, Math.ceil(box.width * scale)), h = Math.min(canvas.height - y, Math.ceil(box.height * scale));
          if (w <= 0 || h <= 0) continue;
          const data = ctx.getImageData(x, y, w, h).data;
          for (let i = 0; i < data.length; i += 4) { const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * (data[i + 3] / 255); if (lum > worst) worst = lum; }
        }
      }
      return Math.round(worst);
    });
    report.push({ page: path, device, horizontalOverflow: overflow, brightestBehindText: behind, errors: errors.splice(0) });
  }
  // The homepage as it scrolls.
  await page.goto(base + "/", { waitUntil: "load" });
  await page.waitForTimeout(3500);
  const pinned = await page.evaluate(() => document.querySelector(".seq").offsetHeight - innerHeight);
  for (const [label, share] of [["1-turn", 0.26], ["2-apart", 0.5], ["3-layers", 0.9]]) {
    await page.evaluate((y) => scrollTo(0, y), Math.round(pinned * share));
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(out, `home-scroll-${label}-${device}.png`) });
  }
  for (const [label, selector] of [["4-hidden", "#hidden"], ["5-added", "#added"], ["6-cta", "#products"]]) {
    await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "start" }), selector);
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(out, `home-scroll-${label}-${device}.png`) });
  }
  await context.close();
}
// Reduced motion: stills, no pinned scroll.
const calm = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const page = await calm.newPage();
await page.goto(base + "/", { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, "home-reduced-motion-desktop.png"), fullPage: false });
await page.evaluate(() => document.querySelector(".still-how").scrollIntoView());
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, "home-reduced-motion-layers-desktop.png") });
await browser.close();
writeFileSync(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.table(report.map((r) => ({ ...r, errors: r.errors.length })));
for (const r of report) for (const e of r.errors) console.log(r.page, r.device, e);
