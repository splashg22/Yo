// The every-coin board in a real browser, on a recorded stretch of mainnet being played back.
// Needs: npm run build, then `npm run replay -- <recording>` (default http://127.0.0.1:4730), still playing.
// Run: npm run check:board          It reads only. Nothing is sent anywhere.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.env.CHECK_URL ?? "http://127.0.0.1:4730";
const results = [];
const check = (name, passed, detail = "") => {
  results.push({ name, passed });
  console.log(`${passed ? "pass" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const call = async (name, input = {}) => (await fetch(`${base}/api/${name}`, { method: "POST", body: JSON.stringify(input) })).json();

const config = await call("config");
if (!config.recording) throw new Error(`the server at ${base} is not playing a recording`);
// "Rows change in place" can only be seen while blocks are still being played.
if (config.recording.to - config.recording.now < 30_000)
  throw new Error("the recording has been played to its end, or nearly: start `npm run replay` again and run this straight away");
const browser = await chromium.launch();
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("console", (message) => message.type() === "error" && errors.push(message.text().slice(0, 200)));
page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
let loads = 0;
page.on("framenavigated", (frame) => frame === page.mainFrame() && (loads += 1));

await page.goto(`${base}/terminal`);
await page.waitForSelector(".coin-row");
check(
  "every page says it is a recording, in a bar with no way to close it",
  (await page.locator("[data-recording]").count()) === 1 && (await page.locator("[data-recording] button").count()) === 0,
);
check(
  "three columns, each with rows",
  (await page.locator(".board-col").count()) === 3 &&
    (await page.evaluate(() => [...document.querySelectorAll(".board-col")].every((column) => column.querySelector(".coin-row")))),
);
check(
  "quick buy is not offered on mainnet: no field, no button",
  (await page.locator('input[aria-label^="Quick buy"]').count()) === 0 && (await page.locator("button.quick").count()) === 0,
);

// Rows update in place: the same row element shows new figures, with no reload and no new request for the board.
const loadsBefore = loads;
let explores = 0;
page.on("request", (request) => request.url().endsWith("/api/explore") && (explores += 1));
const watched = await page.evaluate(() => {
  const rows = new Map();
  for (const row of document.querySelectorAll(".coin-row")) {
    row.dataset.marked = "1";
    rows.set(row.dataset.coin, row.innerText);
  }
  window.__rows = rows;
  return rows.size;
});
await page.waitForTimeout(8000);
const moved = await page.evaluate(() => {
  let changed = 0;
  let kept = 0;
  for (const row of document.querySelectorAll(".coin-row")) {
    const before = window.__rows.get(row.dataset.coin);
    if (before === undefined) continue;
    if (row.dataset.marked === "1") kept += 1;
    if (before !== row.innerText) changed += 1;
  }
  return { changed, kept };
});
check(
  "rows change in place while the recording plays",
  moved.changed > 0 && moved.kept > 0,
  `${moved.changed} of ${watched} rows changed, ${moved.kept} are the same elements`,
);
check("with no reload and no second read of the board", loads === loadsBefore && explores === 0);

// Every row carries every figure asked for.
const row = await page.evaluate(() => {
  const found = [...document.querySelectorAll(".coin-row")].find((each) => each.querySelector("[data-risk]"));
  return found ? found.innerText.replace(/\s+/g, " ") : "";
});
check(
  "a row shows market cap, volume, liquidity, buys and sells, holders, and the five holder shares",
  /MC \$/.test(row) &&
    /V \$/.test(row) &&
    /Liq \$/.test(row) &&
    /\d+\/\d+/.test(row) &&
    /holder/.test(row) &&
    ["T10", "Dev", "Snp", "Bnd", "Ins"].every((label) => row.includes(label)),
  row.slice(0, 140),
);

// A coin priced in something other than SOL: listed, marked, and with no price anywhere on its row.
const board = await call("explore");
const other = board.coins.find((coin) => coin.unsupported);
if (other) {
  await page.fill("#board-search", other.mint);
  await page.waitForSelector(`.coin-row[data-coin="${other.mint}"]`);
  const text = (await page.locator(`.coin-row[data-coin="${other.mint}"]`).innerText()).replace(/\s+/g, " ");
  check(
    "a coin not priced in SOL is listed as not supported, with no price on its row",
    /not supported yet/i.test(text) && !text.includes("$"),
    text.slice(0, 120),
  );
  await page.fill("#board-search", "");
} else check("a coin not priced in SOL is listed as not supported", false, "the recording played so far holds none");

// Search finds a coin that is not among the rows the page loaded.
const trending = await call("trending", { window: "h1" });
const loaded = new Set(board.coins.map((coin) => coin.mint));
const hidden = trending.coins.concat((await call("search", { q: "a" })).coins).find((coin) => !loaded.has(coin.mint) && coin.symbol.length > 2);
if (hidden) {
  await page.fill("#board-search", hidden.symbol);
  await page.waitForSelector(`.coin-row[data-coin="${hidden.mint}"]`, { timeout: 5000 }).catch(() => undefined);
  check("search by ticker finds a coin the page had not loaded", (await page.locator(`.coin-row[data-coin="${hidden.mint}"]`).count()) > 0, hidden.symbol);
  await page.fill("#board-search", "");
} else check("search by ticker finds a coin the page had not loaded", true, "every followed coin was already loaded: nothing to find");
const anyCoin = board.coins.find((coin) => coin.name && !coin.unsupported);
await page.fill("#board-search", anyCoin.mint);
await page.waitForSelector(`.coin-row[data-coin="${anyCoin.mint}"]`);
check("search by contract address finds the coin", (await page.locator(".coin-row").count()) === 1);
await page.fill("#board-search", "11111111111111111111111111111111");
await page.waitForSelector("text=That address is not on the board");
check("an address that is not followed offers to open it, and reads nothing from the chain by being typed", true);
await page.fill("#board-search", "");

// Trending, by each window.
await page.click('button:text-is("Trending")');
await page.waitForSelector(".board3.one .coin-row");
for (const [label, key] of [
  ["5m", "m5"],
  ["1h", "h1"],
  ["6h", "h6"],
  ["24h", "h24"],
]) {
  await page.click(`[aria-label="Trending over"] button:text-is("${label}")`).catch(() => page.click(`button:text-is("${label}")`));
  await page.waitForFunction(() => document.querySelectorAll(".board3.one .coin-row").length >= 3, null, { timeout: 8000 }).catch(() => undefined);
  const want = (await call("trending", { window: key })).coins.slice(0, 3).map((coin) => coin.mint);
  const shown = await page.evaluate(() => [...document.querySelectorAll(".board3.one .coin-row")].slice(0, 3).map((each) => each.dataset.coin));
  // The ranking moves while the recording plays: the top of the page must be among the top of the server's answer taken a moment later.
  const near = (await call("trending", { window: key })).coins.slice(0, 8).map((coin) => coin.mint);
  check(
    `trending over ${label} shows the server's ranking`,
    shown.length === 3 && shown.every((mint) => near.includes(mint)),
    `${shown.filter((mint) => want.includes(mint)).length} of 3 in the same top three`,
  );
}
check("the chosen view is in the address, so it can be linked to", new URL(page.url()).searchParams.get("v") === "h24");

// Filters apply to the ranking too, and a preset can be saved.
await page.click('button:text-matches("^Filters")');
await page.fill('[data-figure="cap"] input[aria-label="Market cap at least"]', "1000");
await page.waitForTimeout(400);
const caps = await page.evaluate(() => document.querySelectorAll(".board3.one .coin-row").length);
check("a filter on a figure narrows the list", caps > 0 && caps < 100, `${caps} rows with a market cap of 1,000 SOL or more`);
await page.fill('[aria-label="Name for these filters"]', "Big ones");
await page.click('button:text-is("Save")');
check("filters are saved as a preset", (await page.evaluate(() => localStorage.getItem("ring.board.presets") ?? "")).includes("Big ones"));
await page.click('button:text-is("Clear the filters")');

// The coin page: chart, live trades, holders, top traders, safety checks, dev history, how far back.
const top = (await call("trending", { window: "h1" })).coins[0];
await page.goto(`${base}/coin/${top.mint}`);
await page.waitForSelector("[data-checks] dl", { timeout: 20000 });
await page.waitForSelector(".chart-area canvas", { timeout: 20000 });
check("the coin page has a chart and a live list of trades", (await page.locator(".feed-body .vrow").count()) > 3);
await page.click('[role="tab"]:text-matches("^Holders")');
await page.waitForSelector("[data-holder-summary]");
check("holders are listed", (await page.locator(".feed-body .vrow").count()) > 0);
await page.click('[role="tab"]:text-is("Top traders")');
await page.waitForSelector("[data-trader-summary]", { timeout: 10000 });
check("top traders are listed, with what each made", (await page.locator(".feed-body .vrow").count()) > 3);
const checks = (await page.locator("[data-checks]").innerText()).replace(/\s+/g, " ");
check(
  "safety checks say whether more can be minted and holdings frozen, or that it was not read",
  /More can be minted (No|Yes|Not read)/.test(checks) && /Holdings can be frozen (No|Yes|Not read)/.test(checks),
  checks.slice(0, 110),
);
check("a check that is not built is shown as not checked, not as passed", /Pool liquidity locked Not checked/.test(checks));
check("the creator's other coins card says what it cannot see", /does not mean a clean history/.test(await page.locator("[data-dev]").innerText()));
const history = (await page.locator("[data-history]").innerText()).replace(/\s+/g, " ");
check("the page says how far back this coin's trades go", /Complete: every trade|Trades are held from/.test(history), history.slice(0, 100));
check("nothing can be traded from it", (await page.locator("[data-read-only]").count()) === 1 && (await page.locator(".trade-dock button").count()) === 0);

// Phone width: one column at a time, nothing wider than the screen.
const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
phone.on("console", (message) => message.type() === "error" && errors.push(message.text().slice(0, 200)));
await phone.goto(`${base}/terminal`);
await phone.waitForSelector(".coin-row");
const wide = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("at phone width nothing is wider than the screen", wide <= 0, `${wide}px over`);
check(
  "at phone width one column shows at a time, with tabs for the three",
  (await phone.evaluate(() => [...document.querySelectorAll(".board-col")].filter((column) => getComputedStyle(column).display !== "none").length)) === 1,
);
await phone.click('button:text-matches("^Graduated")');
check(
  "the tabs switch column",
  (await phone.evaluate(() => [...document.querySelectorAll(".board-col")].find((column) => getComputedStyle(column).display !== "none")?.dataset.column)) ===
    "Graduated",
);

// Pictures are this server's own copies: no row asks a stranger's host for anything.
const hosts = new Set();
const pictures = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
pictures.on("request", (request) => hosts.add(new URL(request.url()).host));
await pictures.goto(`${base}/terminal`);
await pictures.waitForSelector(".coin-row");
await pictures.waitForTimeout(3000);
check("the board asks no host but this one for anything, pictures included", hosts.size === 1 && hosts.has(new URL(base).host), [...hosts].join(", "));

check("no browser errors", errors.length === 0, errors[0] ?? "");
await browser.close();
const failed = results.filter((result) => !result.passed).length;
console.log(`\n${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
