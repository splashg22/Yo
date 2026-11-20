// Captures the real site UI from the live pages with the installed Chrome at device scale 2,
// in a clean state (reduced motion, so the ring is still and the counters show their final text),
// as separate layers into public/ui/, plus captured.json with the texts the site showed.
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "public", "ui");
mkdirSync(out, { recursive: true });
const BASE = process.env.SITE || "https://splashg22.github.io/Yo/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none"] });
const captured = { capturedAt: new Date().toISOString(), base: BASE, home: {}, dashboard: {} };

async function open(path, width = 1920, height = 1080) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.goto(BASE + path, { waitUntil: "networkidle0", timeout: 90_000 });
  await page.evaluate(() => document.fonts.ready);
  return page;
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(page, selector, name, { transparent = true, pad = 0 } = {}) {
  const el = await page.$(selector);
  if (!el) throw new Error(`missing ${selector}`);
  if (transparent) await page.addStyleTag({ content: `.scene,.veil{visibility:hidden!important} html,body{background:transparent!important}` });
  const box = await el.boundingBox();
  const { sx, sy } = await page.evaluate(() => ({ sx: window.scrollX, sy: window.scrollY }));
  // Puppeteer clips in page coordinates (captureBeyondViewport), boundingBox is viewport-relative.
  const clip = { x: Math.max(0, box.x + sx - pad), y: Math.max(0, box.y + sy - pad), width: box.width + pad * 2, height: box.height + pad * 2 };
  await page.screenshot({ path: join(out, `${name}.png`), clip, omitBackground: transparent });
  return { w: Math.round(clip.width), h: Math.round(clip.height) };
}

// ---- Home ----
{
  const page = await open("", 1920, 1080);
  await settle(1500);
  await page.screenshot({ path: join(out, "home-viewport.png") });
  await page.screenshot({ path: join(out, "home-full.png"), fullPage: true });
  const sizes = {};
  for (const [sel, name] of [[".pill-nav", "home-nav"], ["h1", "home-h1"], [".hero-side", "home-side"], ["#cycle .section-head", "home-cycle-head"], ["#numbers .section-head", "home-numbers-head"], ["#tiles", "home-tiles"], ["#numbers .addresses", "home-addresses"], [".footer .wrap", "home-footer"]]) {
    await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center" }), sel);
    await settle(400);
    sizes[name] = await shot(page, sel, name);
  }
  // The ring and the wheel card at each step (the site's own wheel selects the step).
  await page.evaluate(() => document.querySelector("#ring").scrollIntoView({ block: "center" }));
  await settle(400);
  sizes["home-ring"] = await shot(page, "#ring", "home-ring");
  for (let i = 0; i < 5; i++) {
    await page.evaluate((k) => { document.querySelector(`#wheel-opt-${k}`).click(); document.querySelector(".cycle-card").scrollIntoView({ block: "center" }); }, i);
    await settle(1200);
    const sel = await page.$eval(".wheel-item.is-selected", (e) => e.innerText); if (!sel) throw new Error("wheel did not select"); console.log("wheel step", i, sel);
    sizes[`home-cycle-card-${i}`] = await shot(page, ".cycle-card", `home-cycle-card-${i}`);
    sizes[`home-wheel-${i}`] = await shot(page, "#wheel", `home-wheel-${i}`);
  }
  captured.home = {
    sizes,
    h1: await page.$eval("h1", (e) => e.innerText),
    lede: await page.$eval(".lede", (e) => e.innerText),
    tiles: await page.$$eval("#tiles .tile", (els) => els.map((t) => ({ label: t.querySelector(".label").innerText, value: t.querySelector(".value").innerText, status: t.querySelector(".status").innerText }))),
    wheel: await page.$$eval(".wheel-item", (els) => els.map((e) => e.innerText)),
    cycleTexts: [],
  };
  for (let i = 0; i < 5; i++) { await page.evaluate((k) => document.querySelector(`#wheel-opt-${k}`).click(), i); await settle(300); captured.home.cycleTexts.push(await page.$eval("#cycle-text", (e) => e.innerHTML)); }
  await page.close();
}

// ---- Dashboard ----
{
  const page = await open("dashboard.html", 1920, 1080);
  await page.waitForFunction(() => { const v = document.querySelector("#ov-supply"); return v && !v.querySelector(".skeleton") && /\d/.test(v.textContent); }, { timeout: 90_000 });
  await page.waitForFunction(() => !document.querySelector("#tbody .skeleton") && /No activity|Solscan|\d{4}-/.test(document.querySelector("#tbody").textContent), { timeout: 90_000 });
  await settle(1500);
  await page.screenshot({ path: join(out, "dash-viewport.png") });
  await page.screenshot({ path: join(out, "dash-full.png"), fullPage: true });
  const sizes = {};
  for (const [sel, name] of [[".pill-nav", "dash-nav"], ["#treasury .section-head", "dash-head"], ["#overview", "dash-overview"], ["#kpis", "dash-kpis"], ["#history .section-head", "dash-history-head"], ["#history .panel", "dash-history"], ["#history .addresses", "dash-addresses"], [".footer .wrap", "dash-footer"]]) {
    await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center" }), sel);
    await settle(400);
    sizes[name] = await shot(page, sel, name);
  }
  const text = (sel) => page.$eval(sel, (e) => e.innerText);
  captured.dashboard = {
    sizes,
    updated: await text("#updated"),
    overview: await page.$$eval("#overview .item", (els) => els.map((t) => ({ label: t.querySelector(".label").innerText, value: t.querySelector(".value .num").innerText, unit: t.querySelector(".value small")?.innerText || "", sub: t.querySelector(".sub").innerHTML }))),
    kpis: await page.$$eval("#kpis .tile", (els) => els.map((t) => ({ label: t.querySelector(".label").innerText, value: t.querySelector(".value .num").innerText, unit: t.querySelector(".value small")?.innerText || "", sub: t.querySelector(".sub").innerText }))),
    filters: await page.$$eval("#filters .chip", (els) => els.map((b) => ({ label: b.innerText, pressed: b.getAttribute("aria-pressed") === "true" }))),
    tableHead: await page.$$eval("thead th", (els) => els.map((t) => t.innerText)),
    tableBody: await text("#tbody"),
    rowCount: await page.$$eval("#tbody tr", (els) => els.filter((r) => !r.querySelector(".table-empty")).length),
    activityNote: await text("#activity-note"),
    addresses: await page.$$eval("#history .addr", (els) => els.map((a) => ({ k: a.querySelector(".k").innerText, v: a.querySelector("code").innerText }))),
    footer: await text(".footer .wrap"),
  };
  await page.close();
}
await browser.close();
writeFileSync(join(here, "src", "captured.json"), JSON.stringify(captured, null, 2));
console.log(JSON.stringify({ supply: captured.dashboard.overview[2], updated: captured.dashboard.updated, rows: captured.dashboard.rowCount }, null, 1));
