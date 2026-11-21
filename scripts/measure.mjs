// Page weight and load time for the main pages, as a browser sees them (cold cache).
// Needs a server on PORT (default 3311). Prints one line per page.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const base = `http://127.0.0.1:${process.env.PORT ?? 3311}`;
const browser = await chromium.launch();
const rows = [];
for (const path of ["/", "/explore", "/wallet", "/launch", "/pay", "/docs"]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await client.send("Network.enable");
  const sizes = new Map();
  let loaded = false,
    script = 0,
    total = 0;
  client.on("Network.responseReceived", (e) => sizes.set(e.requestId, { type: e.type, url: e.response.url }));
  client.on("Network.loadingFinished", (e) => {
    const entry = sizes.get(e.requestId);
    if (!entry || loaded) return;
    total += e.encodedDataLength;
    if (entry.type === "Script") script += e.encodedDataLength;
  });
  page.on("load", () => {
    loaded = true;
  });
  await page.goto(base + path, { waitUntil: "load" });
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    return { load: Math.round(nav.loadEventEnd), paint: paint ? Math.round(paint.startTime) : null };
  });
  await page.waitForTimeout(1500);
  const shift = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) total += e.value;
        }).observe({ type: "layout-shift", buffered: true });
        setTimeout(() => resolve(Math.round(total * 1000) / 1000), 300);
      }),
  );
  rows.push({
    page: path,
    "transferred before load (KB)": Math.round(total / 1024),
    "of which script (KB)": Math.round(script / 1024),
    "first paint (ms)": timing.paint,
    "load (ms)": timing.load,
    "layout shift": shift,
  });
  await context.close();
}
await browser.close();
console.table(rows);
