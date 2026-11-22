// The performance test. It starts this app on the made-up chain (scripts/sim-server.ts), trading one coin
// fifty times a second, drives a real browser against it, and fails (exit 1) if a budget is missed.
// Needs a build (npm run build). Run: npm run perf
//
// What the numbers are, and are not: a headless Chromium on this machine, with the phone and the 4G link
// emulated by the browser (processor slowed four times; 9 Mbit/s down, 1.5 up, 60 ms added to every request).
// They are not measurements on a real phone or a real network, and the chain behind the pages is made up.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");

const BUDGET = {
  /** First load on the emulated phone on 4G: the largest thing on the first screen is painted. */
  firstLoadMs: 1500,
  /** Going from one page of the app to another: the new page's own content is on the screen. */
  pageChangeMs: 200,
  /** Opening a coin from the board: candles are drawn. */
  chartMs: 300,
  /** Frames a second on the trading screen while the coin trades 50 times a second. */
  framesPerSecond: 55,
  /** The share of frames that may take longer than 50 ms under that stream. */
  slowFrameShare: 0.01,
  /** Layout shift on first load. */
  layoutShift: 0.02,
  /** Script sent for a first load, compressed, in kB. Set 15% above what was measured on 22 November 2026, so growth is noticed. */
  scriptKb: { "/": 250, "/terminal": 250, coin: 290 },
};
const FOUR_G = { offline: false, latency: 60, downloadThroughput: (9_000_000 / 8) | 0, uploadThroughput: (1_500_000 / 8) | 0 };
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1440, height: 900 };

const results = [];
const record = (label, value, passed) => {
  results.push({ label, value, passed });
  console.log(`${passed === null ? "    " : passed ? "ok  " : "FAIL"} ${label}: ${value}`);
};
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const worst = (values) => Math.max(...values);

// ---- the server ----------------------------------------------------------------------------
const server = spawn("npx", ["tsx", "scripts/sim-server.ts"], {
  env: { ...process.env, SIM_PORT: process.env.SIM_PORT ?? "4720" },
  stdio: ["ignore", "pipe", "inherit"],
});
const ready = await new Promise((resolve, reject) => {
  let text = "";
  const timer = setTimeout(() => reject(new Error("the made-up server did not start within two minutes")), 120_000);
  server.stdout.on("data", (chunk) => {
    text += chunk;
    const line = text.split("\n").find((entry) => entry.startsWith('{"ready"'));
    if (line) (clearTimeout(timer), resolve(JSON.parse(line)));
  });
  server.on("exit", (code) => reject(new Error(`the made-up server stopped with code ${code}`)));
});
const { url, mint, tradesPerSecond } = ready;
const browser = await chromium.launch();

async function open(viewport, { phone = false } = {}) {
  const context = await browser.newContext({ viewport, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await client.send("Network.enable");
  if (phone) {
    await client.send("Network.emulateNetworkConditions", FOUR_G);
    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  let scriptBytes = 0;
  const kinds = new Map();
  client.on("Network.responseReceived", (event) => kinds.set(event.requestId, event.type));
  client.on("Network.loadingFinished", (event) => {
    if (kinds.get(event.requestId) === "Script") scriptBytes += event.encodedDataLength;
  });
  await page.addInitScript(() => {
    window.__lcp = 0;
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__lcp = Math.max(window.__lcp, entry.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  return { context, page, script: () => scriptBytes };
}

try {
  // ---- first load, phone on 4G ---------------------------------------------------------------
  for (const [name, path] of [
    ["/", "/"],
    ["/terminal", "/terminal"],
    ["coin", `/coin/${mint}`],
  ]) {
    const runs = [];
    let shift = 0;
    let script = 0;
    for (let run = 0; run < 3; run++) {
      const { context, page, script: sent } = await open(PHONE, { phone: true });
      await page.goto(url + path, { waitUntil: "load" });
      await page.waitForTimeout(2500);
      const seen = await page.evaluate(() => ({
        lcp: window.__lcp,
        cls: window.__cls,
        fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0,
      }));
      runs.push(seen);
      shift = Math.max(shift, seen.cls);
      script = sent();
      await context.close();
    }
    const lcp = median(runs.map((run) => run.lcp));
    record(
      `First load of ${name === "coin" ? "a coin's page" : name}, phone on 4G`,
      `largest paint ${Math.round(lcp)} ms (median of 3; worst ${Math.round(worst(runs.map((run) => run.lcp)))}), first paint ${Math.round(median(runs.map((run) => run.fcp)))} ms (budget ${BUDGET.firstLoadMs} ms)`,
      lcp < BUDGET.firstLoadMs,
    );
    record(`  layout shift`, shift.toFixed(3), shift < BUDGET.layoutShift);
    record(`  script sent, compressed`, `${Math.round(script / 1000)} kB (budget ${BUDGET.scriptKb[name]} kB)`, script / 1000 < BUDGET.scriptKb[name]);
  }

  // ---- page changes, desktop ------------------------------------------------------------------
  {
    const { context, page } = await open(DESK);
    /** Presses `press` and returns how long until `appears` is on the screen, timed inside the page. */
    const change = (press, appears) =>
      page.evaluate(
        ([pressSelector, appearsSelector]) =>
          new Promise((resolve, reject) => {
            const target = document.querySelector(pressSelector);
            if (!target) return reject(new Error(`nothing to press: ${pressSelector}`));
            const started = performance.now();
            const done = () => {
              if (!document.querySelector(appearsSelector)) return false;
              // The next frame is when it is actually painted.
              requestAnimationFrame(() => resolve(performance.now() - started));
              return true;
            };
            const observer = new MutationObserver(() => done() && observer.disconnect());
            observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
            setTimeout(() => reject(new Error(`${appearsSelector} never appeared`)), 10_000);
            target.click();
          }),
        [press, appears],
      );
    await page.goto(`${url}/terminal`, { waitUntil: "load" });
    await page.waitForSelector(".coin-row a");
    await page.waitForTimeout(1500); // the links on the screen have been prefetched, as they are for a person who has looked at the page
    const timings = { "board to a coin": [], "coin to the board": [], "board to all coins": [], "all coins to the portfolio": [] };
    const chart = [];
    for (let round = 0; round < 4; round++) {
      await page.waitForSelector(`.coin-row[data-coin="${mint}"] a`);
      const clickedAt = await page.evaluate(() => performance.now());
      timings["board to a coin"].push(await change(`.coin-row[data-coin="${mint}"] a`, ".trade-screen h1"));
      await page.waitForFunction(() => performance.getEntriesByName("chart:first-candles").length > 0, null, { timeout: 10_000 });
      chart.push(await page.evaluate((from) => performance.getEntriesByName("chart:first-candles").at(-1).startTime - from, clickedAt));
      await page.evaluate(() => performance.clearMarks("chart:first-candles"));
      timings["coin to the board"].push(await change('header a[href="/terminal"]', ".board3 .coin-row"));
      timings["board to all coins"].push(await change('header a[href="/explore"]', "table[data-coins] tbody tr"));
      timings["all coins to the portfolio"].push(await change('header a[href="/portfolio"]', "main h1"));
      await change('header a[href="/terminal"]', ".board3 .coin-row");
    }
    for (const [name, took] of Object.entries(timings)) {
      // The first round includes fetching the page's code; a person pays that once. Both are reported; the budget is on the worst.
      record(
        `Page change, ${name}`,
        `first ${Math.round(took[0])} ms, then ${took
          .slice(1)
          .map((value) => Math.round(value))
          .join(", ")} ms (budget ${BUDGET.pageChangeMs} ms)`,
        worst(took) < BUDGET.pageChangeMs,
      );
    }
    record(
      "Opening a coin from the board: candles drawn",
      `first ${Math.round(chart[0])} ms, then ${chart
        .slice(1)
        .map((value) => Math.round(value))
        .join(", ")} ms after the press (budget ${BUDGET.chartMs} ms)`,
      worst(chart) < BUDGET.chartMs,
    );
    await context.close();
  }
  {
    const { context, page } = await open(DESK);
    await page.goto(`${url}/coin/${mint}`, { waitUntil: "load" });
    await page.waitForFunction(() => performance.getEntriesByName("chart:first-candles").length > 0, null, { timeout: 15_000 });
    const cold = await page.evaluate(() => performance.getEntriesByName("chart:first-candles")[0].startTime);
    record("A coin's page opened cold: candles drawn", `${Math.round(cold)} ms after the address was entered (no budget: it includes loading the page)`, null);
    await context.close();
  }

  // ---- frames under a fast stream --------------------------------------------------------------
  const frames = async (page, seconds) =>
    page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          const gaps = [];
          let longTasks = 0;
          const observer = new PerformanceObserver((list) => (longTasks += list.getEntries().length));
          observer.observe({ type: "longtask" });
          const started = performance.now();
          let last = started;
          const tick = (now) => {
            gaps.push(now - last);
            last = now;
            if (now - started < ms) return requestAnimationFrame(tick);
            observer.disconnect();
            gaps.shift();
            const sorted = [...gaps].sort((a, b) => a - b);
            resolve({
              fps: (gaps.length / (now - started)) * 1000,
              slow: gaps.filter((gap) => gap > 50).length / gaps.length,
              p95: sorted[Math.floor(sorted.length * 0.95)],
              worst: sorted.at(-1),
              longTasks,
            });
          };
          requestAnimationFrame(tick);
        }),
      seconds * 1000,
    );
  for (const [where, path, viewport, phone, enforced] of [
    ["the trading screen, desktop", `/coin/${mint}`, DESK, false, true],
    ["the board, desktop", "/terminal", DESK, false, true],
    ["the trading screen, phone with the processor slowed four times", `/coin/${mint}`, PHONE, true, false],
  ]) {
    const { context, page } = await open(viewport, { phone });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(url + path, { waitUntil: "load" });
    await page.waitForSelector(path === "/terminal" ? ".coin-row" : ".feed .vrow", { timeout: 20_000 });
    await page.waitForTimeout(1500);
    const tradesBefore = path === "/terminal" ? null : await page.locator(".feed .vrow").first().innerText();
    const seen = await frames(page, 10);
    const tradesAfter = path === "/terminal" ? null : await page.locator(".feed .vrow").first().innerText();
    if (tradesBefore !== null && tradesBefore === tradesAfter) errors.push("the trades list did not move during ten seconds of trading");
    const passed = seen.fps >= BUDGET.framesPerSecond && seen.slow <= BUDGET.slowFrameShare && errors.length === 0;
    record(
      `${tradesPerSecond} trades a second on ${where}`,
      `${seen.fps.toFixed(1)} frames a second, ${(seen.slow * 100).toFixed(1)}% of frames over 50 ms, 95th frame ${seen.p95.toFixed(1)} ms, worst ${seen.worst.toFixed(0)} ms, ${seen.longTasks} long tasks${errors.length ? `, errors: ${errors[0]}` : ""}${enforced ? ` (budget ${BUDGET.framesPerSecond} a second, ${BUDGET.slowFrameShare * 100}% slow)` : " (measured, not a budget)"}`,
      enforced ? passed : errors.length === 0 ? null : false,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.kill("SIGTERM");
}
const failed = results.filter((entry) => entry.passed === false).length;
console.log(failed === 0 ? "Every performance budget held." : `${failed} performance budget(s) missed.`);
process.exit(failed === 0 ? 0 : 1);
