// Records where each UI block sits on the real pages (document coordinates, CSS px at 1920 wide),
// so the composition can place the captured layers and the rebuilt panels exactly where the site puts them.
import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SITE || "https://splashg22.github.io/Yo/";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--hide-scrollbars"] });
const boxes = async (path, sels, waitFn) => {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.goto(BASE + path, { waitUntil: "networkidle0", timeout: 90_000 });
  await page.evaluate(() => document.fonts.ready);
  if (waitFn) await page.waitForFunction(waitFn, { timeout: 90_000 });
  await new Promise((r) => setTimeout(r, 1200));
  const out = await page.evaluate((sels) => {
    const r = {};
    for (const [key, sel] of Object.entries(sels)) {
      const el = document.querySelector(sel); if (!el) { r[key] = null; continue; }
      const b = el.getBoundingClientRect();
      r[key] = { x: +(b.left + scrollX).toFixed(1), y: +(b.top + scrollY).toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
    }
    r.__page = { h: document.documentElement.scrollHeight };
    return r;
  }, sels);
  await page.close();
  return out;
};
const home = await boxes("", {
  nav: ".pill-nav", logo: ".pill-nav .logo", navDashboard: '.pill-nav .bar a[href="./dashboard.html"]', navHow: '.pill-nav .bar a[href="#cycle"]', h1: "h1", side: ".hero-side", lede: ".lede", btnDash: "#dash-hero", btnHow: '.actions .btn-ghost',
  ring: "#ring", ringCaption: ".ring-caption", cycleHead: "#cycle .section-head", wheel: "#wheel", cycleCard: ".cycle-card", cyclePhoto: ".cycle-photo", cycleCta: "#cycle-cta",
  numbersHead: "#numbers .section-head", tiles: "#tiles", addresses: "#numbers .addresses", footer: ".footer .wrap",
});
const dash = await boxes("dashboard.html", {
  nav: ".pill-nav", logo: ".pill-nav .logo", refresh: "#refresh", head: "#treasury .section-head", updated: "#updated", treasuryLink: "#treasury-link", overview: "#overview", ovSupply: "#ov-supply", kpis: "#kpis",
  historyHead: "#history .section-head", history: "#history .panel", filters: "#filters", chipStrategy: '#filters .chip[data-k="strategy"]', chipAll: '#filters .chip[data-k="all"]', table: "#history table", tbody: "#tbody", addresses: "#history .addresses", addrTreasury: "#history .addr:first-child", copyTreasury: "#history .addr:first-child .copy", footer: ".footer .wrap",
}, () => { const v = document.querySelector("#ov-supply"); return v && !v.querySelector(".skeleton") && /\d/.test(v.textContent) && !document.querySelector("#tbody .skeleton"); });
await browser.close();
const captured = JSON.parse(readFileSync(join(here, "src", "captured.json"), "utf8"));
captured.boxes = { home, dashboard: dash };
writeFileSync(join(here, "src", "captured.json"), JSON.stringify(captured, null, 2));
console.log(JSON.stringify({ home, dash }));
