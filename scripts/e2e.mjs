// Drives the real pages in a browser, as two people, against the local validator.
// Every flow is run twice in a row and a third time after a page reload, and after each
// action the balances on screen are compared with balances read straight from the chain.
// Needs the validator and `npm run start -- -p 4711`. Run: npm run e2e
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { formatCoin, formatShare, parseAmount } from "../lib/format.ts";
import { NATIVE, decimalsOf } from "../lib/constants.ts";

const { chromium } = createRequire(import.meta.url)("playwright");
const base = `http://127.0.0.1:${process.env.PORT ?? 4711}`;
const rpcUrl = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8799";
const PASSWORD = "correct horse battery";
mkdirSync("shots/app", { recursive: true });

// ---- reading the chain directly, without going through the app -------------------------
async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
async function onChain(owner, mint) {
  if (mint === NATIVE) return BigInt((await rpc("getBalance", [owner, { commitment: "confirmed" }])).value);
  const found = await rpc("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }]);
  return found.value.reduce((sum, account) => sum + BigInt(account.account.data.parsed.info.tokenAmount.amount), 0n);
}
const supplyOf = async (mint) => BigInt((await rpc("getTokenSupply", [mint, { commitment: "confirmed" }])).value.amount);
async function app(op, input = {}) {
  const response = await fetch(`${base}/api/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${op}: ${body.error}`);
  return body;
}

// ---- the run ---------------------------------------------------------------------------
const browser = await chromium.launch();
const results = [];
const errors = [];
async function person(name) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${name}: ${error}`));
  page.on("console", (message) => message.type() === "error" && errors.push(`${name}: ${message.text()}`));
  page.on("response", (response) => {
    if (response.status() >= 400)
      void response.text().then((body) => errors.push(`${name}: ${response.status()} ${response.url().replace(base, "")} ${body.slice(0, 160)}`));
  });
  page.on("requestfailed", (request) => !/_rsc=/.test(request.url()) && errors.push(`${name}: request failed ${request.url()}`));
  return page;
}
async function step(label, run) {
  try {
    await run();
    results.push(["ok", label]);
    console.log("ok  ", label);
  } catch (error) {
    results.push(["FAIL", label]);
    console.log("FAIL", label, "::", String(error.message).split("\n")[0].slice(0, 300));
  }
}
const shot = (page, name) => page.screenshot({ path: `shots/app/${name}.png` });
/** Starts recording every status line the page shows from now on, so a repeat of an earlier message is not mistaken for a new one. */
const arm = (page) =>
  page.evaluate(() => {
    window.__said = [];
    window.__clickedAt = null;
    window.__answeredAt = null;
    addEventListener("click", () => (window.__clickedAt ??= performance.now()), { capture: true, once: true });
    window.__watch?.disconnect();
    // What each status line said before the click. Only a line whose words have changed since counts as the page speaking:
    // anything else on the page changing (the tray, a clock) must not make an old message look like a new one.
    const last = new Map([...document.querySelectorAll(".status-line")].map((line) => [line, line.innerText]));
    window.__watch = new MutationObserver(() => {
      for (const line of document.querySelectorAll(".status-line")) {
        const text = line.innerText;
        if (last.get(line) === text) continue;
        last.set(line, text);
        if (!text.trim()) continue;
        if (window.__clickedAt !== null) window.__answeredAt ??= performance.now();
        window.__said.push(text);
      }
    });
    window.__watch.observe(document.body, { childList: true, characterData: true, subtree: true });
  });
/** Clicks, then waits for a status line matching `pattern` that appeared after the click. */
async function press(page, selector, pattern, timeout = 60000) {
  await arm(page);
  await page.click(selector);
  // How long the page took to say anything at all after the click.
  await page.waitForFunction(() => window.__answeredAt !== null, null, { timeout }).catch(() => undefined);
  const waited = await page.evaluate(() => (window.__answeredAt === null ? null : window.__answeredAt - window.__clickedAt)).catch(() => null);
  if (waited !== null) responses.push([Math.round(waited), selector]);
  try {
    await page.waitForFunction((source) => window.__said.some((text) => new RegExp(source, "i").test(text)), pattern.source, { timeout });
  } catch {
    throw new Error(`after "${selector}" the page said: ${JSON.stringify(await page.evaluate(() => [...new Set(window.__said)].slice(-3)))}`);
  }
}
/** Waits until `read` returns `want`; on timeout says what it found instead. */
async function settles(read, want, what) {
  const deadline = Date.now() + 20000;
  let got;
  while (Date.now() < deadline) {
    got = await read();
    if (got === want) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${what}: the page shows "${got}", expected "${want}"`);
}

/** Milliseconds from each click to the first word of status, with the control that was clicked. */
const responses = [];
/** A small real PNG, made here, to launch a coin with. */
const PICTURE = await createRequire(import.meta.url)("sharp")({ create: { width: 240, height: 160, channels: 3, background: "#f5a524" } })
  .png()
  .toBuffer();
/** What a payout costs the withdrawing wallet when no account has to be opened: the network fee, in lamports. */
const PAYOUT_FEE = 5_000n;
const symbols = { [NATIVE]: "SOL" };
/** What each person should hold in the Ring, kept by this script from the actions it took. */
const expected = { seller: {}, buyer: {} };
const addresses = {};
const move = (who, mint, delta) => (expected[who][mint] = (expected[who][mint] ?? 0n) + delta);
const units = (mint, text) => parseAmount(text, decimalsOf(mint));

async function cell(page, mint, column) {
  const row = page.locator("table.plain tbody tr").filter({ has: page.locator(`td:first-child:text-is("${symbols[mint]}")`) });
  return (
    await row
      .locator("td")
      .nth(column)
      .innerText({ timeout: 5000 })
      .catch(() => "(no row)")
  ).trim();
}
/** The wallet page must show the chain's own figure for the wallet, and this script's ledger for the Ring. */
async function walletMatches(page, who, mint) {
  await settles(async () => cell(page, mint, 1), formatCoin(mint, await onChain(addresses[who], mint)), `${who} ${symbols[mint]} in wallet, against the chain`);
  await settles(async () => cell(page, mint, 2), formatCoin(mint, expected[who][mint] ?? 0n), `${who} ${symbols[mint]} in the Ring`);
}

async function makeWallet(page) {
  await page.goto(`${base}/wallet`);
  await page.fill("#wallet-password", PASSWORD);
  await page.fill("#wallet-password-again", PASSWORD);
  await page.click("text=Create wallet");
  await page.waitForSelector(".kv .address", { timeout: 30000 });
  return page.locator(".kv .address").first().getAttribute("title");
}
async function walletAction(page, tab, { mint, amount, to, memo }) {
  await page.waitForSelector("#w-amount, .confirm");
  await page.click(`.tabs button:text-is("${tab}")`);
  await choose(page, "w-coin", mint);
  await page.fill("#w-amount", amount);
  if (to !== undefined) await page.fill("#w-to", to);
  if (memo !== undefined) await page.fill("#w-memo", memo);
  await page.click("button:text-is('Review')");
  await page.waitForSelector(".confirm .panel");
}
/** Picks an option of one of the site's own dropdowns, by its value. */
async function choose(page, id, value) {
  await page.click(`#${id}`);
  await page.click(`[role="listbox"] [data-value="${value}"]`);
}
/** Clears the transaction tray, so the next entry in it is the next action's. */
const clearTray = (page) => page.evaluate(() => document.querySelectorAll(".tray button[aria-label='Dismiss']").forEach((button) => button.click()));
/** Waits for the tray to say how the newest action ended. Returns what it said if it was confirmed; throws what it said if not. */
async function landed(page, timeout = 60000) {
  await page.waitForFunction(() => ["confirmed", "failed", "expired"].includes([...document.querySelectorAll(".tray > div")].at(-1)?.dataset.state), null, {
    timeout,
  });
  const last = page.locator(".tray > div").last();
  const [state, text] = [await last.getAttribute("data-state"), (await last.innerText()).replace(/\s+/g, " ")];
  if (state !== "confirmed") throw new Error(`the tray says: ${text}`);
  if (!(await last.locator("a:text-is('Receipt')").count())) throw new Error("a confirmed transaction has no receipt link in the tray");
  return text;
}
/** Runs `once` for each item: the first two back to back, the third after a full reload of the page. */
async function thrice(page, items, once) {
  for (const [index, item] of items.entries()) {
    if (index === 2) await page.reload();
    await once(item, index);
  }
}

const ana = await person("seller");
const ben = await person("buyer");
const coins = [];
let escrow;

await step("no wallet needed: two wallets are made in the browser, survive a reload, and the faucet figure matches the chain", async () => {
  addresses.seller = await makeWallet(ana);
  addresses.buyer = await makeWallet(ben);
  if (!addresses.seller || addresses.seller === addresses.buyer) throw new Error("no address, or the same address twice");
  for (const [who, page] of [
    ["seller", ana],
    ["buyer", ben],
  ]) {
    await thrice(page, [1, 2, 3], async () => {
      await page.waitForSelector("text=Get test SOL");
      const before = await onChain(addresses[who], NATIVE);
      await press(page, "text=Get test SOL", /10 test SOL added/);
      // The page speaks the moment the airdrop is confirmed; the balance at that same level can be an instant behind it.
      // So the figure is waited for, and it must be exactly 10 SOL: not less, and not 20.
      await settles(async () => String((await onChain(addresses[who], NATIVE)) - before), "10000000000", `${who}: lamports gained from the faucet`);
      await walletMatches(page, who, NATIVE);
    });
    const shown = (await page.locator(".kv .address").first().innerText()).trim();
    if (shown !== addresses[who]) throw new Error(`after a reload the address reads ${shown}`);
  }
  escrow = (await app("status")).escrowAddress;
  await shot(ana, "01-wallet");
});

await step("backup: the saved file restores the same wallet in a clean browser; a wrong password is refused", async () => {
  const [download] = await Promise.all([ana.waitForEvent("download"), ana.click("text=Save encrypted backup")]);
  const path = `shots/app/backup-${Date.now()}.json`;
  await download.saveAs(path);
  const other = await person("restored");
  await other.goto(`${base}/wallet`);
  await other.click("text=Restore from a backup file");
  await other.setInputFiles("#backup-file", path);
  await other.fill("#wallet-password", "not the password");
  await other.click("button:text-is('Restore')");
  await other.waitForFunction(() => /password/i.test(document.querySelector(".status-line.bad")?.innerText ?? ""), null, { timeout: 30000 });
  await other.fill("#wallet-password", PASSWORD);
  await other.click("button:text-is('Restore')");
  await other.waitForSelector(".kv .address", { timeout: 30000 });
  const restored = await other.locator(".kv .address").first().getAttribute("title");
  if (restored !== addresses.seller) throw new Error(`restored ${restored}`);
  await other.context().close();
  (await import("node:fs")).rmSync(path);
});

await step("launch, three times: create on the curve + register with the Ring + first buy into the Ring, one signature each", async () => {
  await ana.goto(`${base}/launch`);
  await thrice(
    ana,
    [
      ["Lantern", "LNTRN"],
      ["Ember", "EMBER"],
      ["Quill", "QUILL"],
    ],
    async ([name, symbol], index) => {
      await ana.fill("#l-name", name);
      await ana.fill("#l-symbol", symbol);
      await ana.fill("#l-buy", "0.02");
      // The first coin gets a picture and a description; the other two are launched without, as most test coins are.
      if (index === 0) {
        await ana.fill("#l-description", "A lantern, for the tests.");
        await ana.setInputFiles("#l-picture", { name: "lantern.png", mimeType: "image/png", buffer: PICTURE });
      }
      await ana.click("button:text-is('Review')");
      await ana.waitForSelector(".confirm .panel");
      if ((await ana.locator(".confirm .panel").count()) !== 3) throw new Error("expected three privacy panels: launch, curve trade, deposit");
      if (index === 0) await shot(ana, "02-launch-review");
      await ana.click("text=Sign and launch");
      await ana.waitForSelector("text=is on the curve and registered with the Ring", { timeout: 60000 });
      const mint = await ana.locator(".kv .address").first().getAttribute("title");
      symbols[mint] = symbol;
      coins.push(mint);
      // The chain, not the app, says the coin exists and where the first buy went.
      if ((await supplyOf(mint)) <= 0n) throw new Error("the chain has no supply for the new coin");
      const inEscrow = await onChain(escrow, mint);
      if (inEscrow <= 0n) throw new Error("the first buy did not reach the Ring's escrow on the chain");
      if ((await onChain(addresses.seller, mint)) !== 0n) throw new Error("the first buy was meant to go to the Ring, but the wallet holds coins");
      move("seller", mint, inEscrow);
      if (index === 0) await shot(ana, "03-launched");
      if (index < 2) await ana.click("text=Launch another");
    },
  );
  await ana.goto(`${base}/wallet`);
  for (const mint of coins) await walletMatches(ana, "seller", mint);
});
const [mint] = coins;

await step("explore lists all three coins in a table, newest first, each with its figures and its Ring line", async () => {
  await ana.goto(`${base}/explore`);
  const ROWS = "table[data-coins] tbody tr";
  await ana.waitForSelector(ROWS);
  const rows = await ana.locator(ROWS).allInnerTexts();
  if (rows.length !== 3) throw new Error(`${rows.length} coins listed`);
  for (const text of rows) if (!/SOL/.test(text) || !/\$/.test(text)) throw new Error(`a row has no SOL or no dollar figure: ${text.replace(/\s+/g, " ")}`);
  // Each coin's first buy went into the Ring from one wallet: the Ring cell says a share above zero, and one wallet.
  for (const text of await ana.locator(`${ROWS} [data-ring]`).allInnerTexts())
    if (!/^\d+\.\d\d% · 1$/.test(text.trim()) || /^0\.00%/.test(text.trim())) throw new Error(`Ring cell reads "${text}"`);
  // The coin launched with a picture shows it, drawn; the two without show their first letter in the same square.
  await ana.waitForFunction(
    () =>
      [...document.querySelectorAll("table[data-coins] .coin-picture > img")].some(
        (image) => image.complete && image.naturalWidth === 512 && getComputedStyle(image).opacity === "1",
      ),
    null,
    { timeout: 15000 },
  );
  const pictures = await ana.evaluate(() => ({
    drawn: document.querySelectorAll("table[data-coins] .coin-picture > img").length,
    // A coin with no picture has only its letter in the box; one with a picture has the picture drawn over the letter.
    letters: [...document.querySelectorAll("table[data-coins] .coin-picture")].filter((box) => !box.querySelector("img")).map((box) => box.innerText),
  }));
  if (pictures.drawn !== 1 || pictures.letters.sort().join("") !== "EQ") throw new Error(`pictures: ${JSON.stringify(pictures)}`);
  await ana.fill("#e-search", "ember");
  await settles(async () => String(await ana.locator(ROWS).count()), "1", "coins matching a search for ember");
  await ana.fill("#e-search", "no such coin");
  await ana.waitForSelector("text=No coin here matches");
  await ana.click("button:text-is('Show all')");
  await settles(async () => String(await ana.locator(ROWS).count()), "3", "coins after clearing the search");
  // The dropdown is the site's own, and works from the keyboard as well as the pointer.
  await choose(ana, "e-order", "cap");
  await ana.focus("#e-order");
  await ana.keyboard.press("ArrowDown");
  await ana.keyboard.press("ArrowDown");
  await ana.keyboard.press("Enter");
  if ((await ana.locator("#e-order").innerText()).trim() !== "Most traded in 24 hours") throw new Error("the order dropdown did not follow the keyboard");
  if (await ana.locator("select").count()) throw new Error("a browser dropdown is on the page");
  await shot(ana, "04-explore");
});

await step("trading screen: three typed buys and a sell, each shown as sent then confirmed with a receipt, and matching the chain", async () => {
  await ben.goto(`${base}/coin/${mint}`);
  await thrice(ben, ["0.03", "0.03", "0.03"], async (amount, index) => {
    await ben.waitForSelector("#t-amount");
    // What a trade makes public is on the screen before the button, always.
    if (!/public: your wallet, the coin, the amount and the price/i.test(await ben.locator(".ticket [data-public]").innerText()))
      throw new Error("the ticket does not say what a trade makes public");
    const before = await onChain(addresses.buyer, mint);
    await clearTray(ben);
    await ben.fill("#t-amount", amount);
    if (index === 0) await shot(ben, "05-buy-review");
    await ben.click(".ticket .go");
    if (!/bought/i.test(await landed(ben))) throw new Error("the tray did not say what was bought");
    if ((await onChain(addresses.buyer, mint)) <= before) throw new Error("the chain shows no more coins after the buy");
  });
  await ben.click(".ticket .sides .sell");
  const before = await onChain(addresses.buyer, mint);
  await clearTray(ben);
  await ben.fill("#t-amount", "1000");
  await ben.click(".ticket .go");
  if (!/sold/i.test(await landed(ben))) throw new Error("the tray did not say what was sold");
  if (before - (await onChain(addresses.buyer, mint)) !== units(mint, "1000")) throw new Error("the chain did not lose exactly 1,000 coins");
  // The feed shows the buyer's own trades, marked, newest first, and the position is worked out from them.
  const newest = (await app("coin/trades", { mint, limit: 1 })).trades[0];
  await settles(async () => (await ben.locator("[data-trade]").first().getAttribute("data-trade")) ?? "", newest.s, "the newest trade in the feed");
  if ((await ben.locator(".vrow.mine").count()) < 4) throw new Error("the buyer's own trades are not marked in the feed");
  const position = (await app("position", { wallet: addresses.buyer, mint })).position;
  if (BigInt(position.held) !== (await onChain(addresses.buyer, mint)) || position.buys !== 3 || position.sells !== 1)
    throw new Error(`position: ${JSON.stringify(position)}`);
  await ben.waitForSelector("[data-position]");
  await ben.goto(`${base}/wallet`);
  await walletMatches(ben, "buyer", mint);
  await walletMatches(ben, "buyer", NATIVE);
});

await step("terminal: one-click from the keyboard and the board, under 100 ms to sent; search, pause on hover, portfolio", async () => {
  await ben.goto(`${base}/coin/${mint}`);
  await ben.waitForSelector("#t-amount");
  // One-click is off until it is turned on, and turning it on says what it means first.
  await ben.click(".ticket .tick");
  await ben.waitForSelector("[role='dialog'] >> text=no second step");
  await ben.click("button:text-is('Turn on one-click')");
  const ready = () => ben.waitForFunction(() => /built and ready/.test(document.querySelector("[data-oneclick]")?.textContent ?? ""), null, { timeout: 20000 });
  const times = [];
  for (const way of ["button", "key"]) {
    await ready();
    const before = await onChain(addresses.buyer, mint);
    await clearTray(ben);
    await ben.evaluate(() => (window.__clickToSentMs = undefined));
    if (way === "button") await ben.click(".presets button[data-preset='0']");
    else await ben.keyboard.press("1");
    if (!/bought/i.test(await landed(ben))) throw new Error(`one-click by ${way}: nothing bought`);
    times.push(await ben.evaluate(() => window.__clickToSentMs));
    if ((await onChain(addresses.buyer, mint)) <= before) throw new Error(`one-click by ${way}: the chain shows no more coins`);
  }
  if (times.some((ms) => !(ms < 100))) throw new Error(`press to sent took ${times.map((ms) => Math.round(ms)).join(" and ")} ms`);
  console.log(`     press to sent: ${times.map((ms) => ms.toFixed(1)).join(" ms, ")} ms`);
  // Keys: S and B change sides, ? lists the keys.
  await ben.keyboard.press("s");
  if ((await ben.locator(".ticket .sides .sell").getAttribute("aria-pressed")) !== "true") throw new Error("S did not choose the sell side");
  await ben.keyboard.press("b");
  await ben.keyboard.press("?");
  await ben.waitForSelector("[role='dialog'] >> text=Keys on this screen");
  await ben.keyboard.press("Escape");
  await shot(ben, "05b-trading-screen");

  // The board: three columns, live; this coin and its two siblings are new.
  await ben.goto(`${base}/terminal`);
  const NEW = ".board-col[data-column='New'] .coin-row";
  await settles(async () => String(await ben.locator(NEW).count()), "3", "coins in the New column");
  // A trade made elsewhere reaches the board without a reload: the seller buys through the API, the row's trade count moves.
  const row = ben.locator(`.coin-row[data-coin='${mint}']`);
  const countBefore = (await app("coin", { mint })).trades;
  const beforeQuick = await onChain(addresses.buyer, mint);
  await clearTray(ben);
  await row.locator("button.quick").click();
  if (!/bought/i.test(await landed(ben))) throw new Error("quick buy from the board: nothing bought");
  if ((await onChain(addresses.buyer, mint)) <= beforeQuick) throw new Error("quick buy from the board: the chain shows no more coins");
  await settles(async () => (/(\d+) trades?/.exec(await row.innerText()) ?? [])[1] ?? "", String(countBefore + 1), "the row's trade count, pushed live");
  // Pause on hover, search by the slash key, and an address that is not on the board.
  await ben.hover(NEW);
  await ben.waitForSelector(".board-col[data-column='New'] >> text=Paused");
  await ben.mouse.move(2, 2);
  await ben.keyboard.press("/");
  if ((await ben.evaluate(() => document.activeElement?.id)) !== "board-search") throw new Error("the slash key did not go to the search field");
  await ben.keyboard.type("ember");
  await settles(async () => String(await ben.locator(".board-col .coin-row").count()), "1", "coins matching a search for ember");
  await ben.fill("#board-search", addresses.seller);
  await ben.waitForSelector("text=That address is not on the board");
  await ben.fill("#board-search", "");
  await shot(ben, "05c-board");

  // The portfolio: the position, worked out from the trades, holding what the chain says.
  await ben.goto(`${base}/portfolio`);
  await ben.waitForSelector(`[data-position='${mint}']`);
  const position = (await app("position", { wallet: addresses.buyer, mint })).position;
  if (BigInt(position.held) !== (await onChain(addresses.buyer, mint))) throw new Error("the portfolio's holding is not the chain's");
  if (position.buys !== 6 || position.sells !== 1) throw new Error(`the portfolio counts ${position.buys} buys and ${position.sells} sells`);
  if (!/\$/.test(await ben.locator("[data-totals]").innerText())) throw new Error("the portfolio shows no dollar figures");
  await shot(ben, "05d-portfolio");
  // One-click is switched off again, so nothing later in this run trades by accident.
  await ben.goto(`${base}/coin/${mint}`);
  await ben.waitForSelector("#t-amount");
  await ben.click(".ticket .tick");
  await ben.goto(`${base}/wallet`);
  await walletMatches(ben, "buyer", mint);
});

await step("deposit, three times: the wallet loses and the escrow gains exactly the amount, on the chain", async () => {
  await thrice(
    ben,
    [
      [NATIVE, "1"],
      [NATIVE, "1.5"],
      [mint, "500000"],
    ],
    async ([coin, amount], index) => {
      const held = await onChain(escrow, coin);
      const mine = await onChain(addresses.buyer, coin);
      await walletAction(ben, "deposit", { mint: coin, amount });
      if (index === 0) await shot(ben, "06-deposit-review");
      await press(ben, "text=Sign and deposit", /deposited/);
      if ((await onChain(escrow, coin)) - held !== units(coin, amount)) throw new Error(`escrow did not gain exactly ${amount}`);
      // SOL also pays the network fee, so the wallet loses at least the amount; a coin loses exactly it.
      const lost = mine - (await onChain(addresses.buyer, coin));
      if (coin === NATIVE ? lost < units(coin, amount) || lost > units(coin, amount) + 100_000n : lost !== units(coin, amount))
        throw new Error(`the wallet lost ${lost}`);
      move("buyer", coin, units(coin, amount));
      await walletMatches(ben, "buyer", coin);
    },
  );
});

await step("receipt: the link after a deposit opens a page that agrees with the chain", async () => {
  await ben.click(".status-line a:text-is('Receipt')");
  await ben.waitForSelector("text=Paid into the Ring", { timeout: 20000 });
  const signature = ben.url().split("/tx/")[1];
  const onLedger = await rpc("getTransaction", [signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
  const text = await ben.locator(".kv").innerText();
  if (!text.includes(onLedger.slot.toLocaleString("en-US"))) throw new Error("the slot shown is not the chain's");
  if (!/500,000\s+LNTRN/i.test(text)) throw new Error(text.replace(/\n/g, " | "));
  if (!/PAYING WALLET SPENT\s+500,000 LNTRN/i.test(text.replace(/\n/g, " ")))
    throw new Error(`no line for what the wallet spent: ${text.replace(/\n/g, " | ")}`);
  await shot(ben, "07-receipt");
  await ben.goto(`${base}/wallet`);
});

await step("transfer, three times: Ring balances move on both sides and nothing moves on the chain", async () => {
  const held = await onChain(escrow, mint);
  await thrice(ben, ["100000", "100000", "50000.5"], async (amount, index) => {
    await walletAction(ben, "transfer", { mint, amount, to: addresses.seller, memo: index === 0 ? "for the poster" : "" });
    if (index === 0) {
      const panel = await ben.locator(".confirm .panel").innerText();
      if (!/THE COIN/i.test(panel) || !/THE AMOUNT/i.test(panel) || !/THE RECIPIENT'S WALLET/i.test(panel))
        throw new Error("panel: " + panel.replace(/\n/g, " | "));
      await shot(ben, "08-transfer-review");
    }
    await press(ben, "text=Sign and transfer", /sent/);
    move("buyer", mint, -units(mint, amount));
    move("seller", mint, units(mint, amount));
    await walletMatches(ben, "buyer", mint);
  });
  if ((await onChain(escrow, mint)) !== held) throw new Error("a transfer between Ring balances moved coins on the chain");
  // The note is stored sealed and opened in the browser, a moment after the history arrives.
  await ben.waitForFunction(() => /READABLE ONLY BY YOU AND THE OTHER WALLET: "FOR THE POSTER"/i.test(document.body.innerText), null, { timeout: 15000 });
  const stored = JSON.stringify(await app("ring/public", { wallet: addresses.buyer }));
  if (/poster/i.test(stored)) throw new Error("the server's public record contains the note");
  await ana.goto(`${base}/wallet`);
  await walletMatches(ana, "seller", mint);
  await shot(ben, "09-wallet-after");
});

await step("withdraw, three times: the escrow loses and the wallet gains exactly the amount, on the chain", async () => {
  await thrice(
    ben,
    [
      [mint, "10000"],
      [mint, "10000"],
      [NATIVE, "0.25"],
    ],
    async ([coin, amount]) => {
      const held = await onChain(escrow, coin);
      const mine = await onChain(addresses.buyer, coin);
      await walletAction(ben, "withdraw", { mint: coin, amount, to: "" });
      await press(ben, "text=Sign and withdraw", /withdrew/);
      if ((await onChain(addresses.buyer, coin)) - mine !== units(coin, amount)) throw new Error(`the wallet did not gain exactly ${amount}`);
      const paid = held - (await onChain(escrow, coin));
      if (coin === NATIVE ? paid < units(coin, amount) : paid !== units(coin, amount)) throw new Error(`escrow paid ${paid}`);
      move("buyer", coin, -units(coin, amount));
      // The network fee for the payout is charged to the withdrawing wallet's Ring SOL. The wallet already holds this coin, so there is no rent.
      move("buyer", NATIVE, -PAYOUT_FEE);
      await walletMatches(ben, "buyer", coin);
      await walletMatches(ben, "buyer", NATIVE);
    },
  );
});

await step("OTC, three times: the seller offers a block, the buyer accepts, both sides settle together; one more is cancelled", async () => {
  await ana.goto(`${base}/otc`);
  await ben.goto(`${base}/otc`);
  await thrice(ana, ["100000", "100000", "100000"], async (amount, index) => {
    await ana.waitForSelector("#o-amount");
    await choose(ana, "o-coin", mint);
    await ana.fill("#o-amount", amount);
    await ana.fill("#o-price", "0.1");
    await ana.fill("#o-buyer", addresses.buyer);
    await ana.click("button:text-is('Review')");
    await ana.waitForSelector(".confirm .panel");
    if (index === 0) await shot(ana, "10-otc-review");
    await press(ana, "text=Sign and offer", /offer sent/);
    if (index === 2) await ben.reload();
    else await ben.goto(`${base}/otc`);
    await ben.waitForSelector('.events button:text-is("Accept")', { timeout: 30000 });
    if (index === 0) await shot(ben, "11-otc-offered");
    await ben.click('.events button:text-is("Accept")');
    await press(ben, "text=Sign and buy", /settled/);
    move("seller", mint, -units(mint, amount));
    move("buyer", mint, units(mint, amount));
    move("seller", NATIVE, units(NATIVE, "0.1"));
    move("buyer", NATIVE, -units(NATIVE, "0.1"));
  });
  await ana.fill("#o-amount", "5");
  await ana.fill("#o-price", "0.01");
  await ana.fill("#o-buyer", addresses.buyer);
  await ana.click("button:text-is('Review')");
  await press(ana, "text=Sign and offer", /offer sent/);
  await press(ana, '.events button:text-is("Cancel")', /offer cancelled/);
  for (const [who, page] of [
    ["seller", ana],
    ["buyer", ben],
  ]) {
    await page.goto(`${base}/wallet`);
    await walletMatches(page, who, mint);
    await walletMatches(page, who, NATIVE);
  }
});

await step("pay link, three times: the seller asks by link and QR, the buyer pays from the Ring", async () => {
  await ana.goto(`${base}/pay`);
  await thrice(ana, ["1234.5", "0.000001", "77"], async (amount, index) => {
    await ana.waitForSelector("#p-amount");
    await choose(ana, "p-coin", mint);
    await ana.fill("#p-amount", amount);
    await ana.fill("#p-memo", "two prints");
    await ana.waitForSelector(".qr svg");
    const link = (await ana.locator("#pay-link").innerText()).trim();
    if (!link.includes(addresses.seller)) throw new Error("the link lost the address case: " + link);
    if (index === 0) await shot(ana, "12-pay-link");
    await ben.goto(link);
    if (index === 2) await ben.reload();
    await ben.waitForSelector(".confirm .panel");
    const text = await ben.locator(".confirm").innerText();
    if (!text.includes(formatCoin(mint, units(mint, amount))) || !/TWO PRINTS/i.test(text)) throw new Error(text.replace(/\n/g, " | "));
    if (index === 0) await shot(ben, "13-pay-request");
    await press(ben, "text=Sign and pay", /paid .* from your Ring balance/);
    move("buyer", mint, -units(mint, amount));
    move("seller", mint, units(mint, amount));
  });
  for (const [who, page] of [
    ["seller", ana],
    ["buyer", ben],
  ]) {
    await page.goto(`${base}/wallet`);
    await walletMatches(page, who, mint);
  }
});

await step("privacy score and chart, three times: the coin's two Ring figures are the chain's own, and the chart reads out its candles", async () => {
  await ana.goto(`${base}/coin/${mint}`);
  await thrice(ana, [1, 2, 3], async () => {
    const [supply, inRing] = [await supplyOf(mint), await onChain(escrow, mint)];
    const facts = ana.locator("section[aria-label='In the Ring'] .facts dd");
    await settles(async () => (await facts.nth(0).innerText()).trim(), formatShare(Number((inRing * 1_000_000n) / supply)), "share of supply in Ring balances");
    await settles(async () => (await facts.nth(1).innerText()).trim(), "2", "wallets that have deposited it");
    const served = (await app("coin", { mint })).privacy;
    if (BigInt(served.supply) !== supply || BigInt(served.inRing) !== inRing) throw new Error("the server's supply or Ring total is not the chain's");
    await ana.goto(`${base}/coin/${mint}`);
  });
  // The chart is drawn, reads out the newest candle, and its timeframes change it.
  await ana.waitForSelector(".chart-area canvas");
  await ana.waitForFunction(() => /O .+ H .+ L .+ C .+ V .+ trades?/.test(document.querySelector("[data-readout]")?.textContent ?? ""), null, {
    timeout: 20000,
  });
  const day = (await app("coin/candles", { mint, tf: 86400 })).candles;
  if (day.length !== 1 || !(day[0][2] > day[0][3])) throw new Error("the day candle did not record the price moving");
  const trades = (await app("coin", { mint })).trades;
  if (day[0][6] !== trades) throw new Error(`the day candle counts ${day[0][6]} trades, the coin ${trades}`);
  await ana.click(".chart-bar button:text-is('1d')");
  await ana.waitForFunction((count) => new RegExp(` ${count} trades`).test(document.querySelector("[data-readout]")?.textContent ?? ""), trades, {
    timeout: 20000,
  });
  // The creator's own trades can be picked out of the feed.
  await ana.click(".feed-tabs button:text-is('Creator')");
  await ana.waitForSelector(".feed-body >> text=You");
  await ana.click(".feed-tabs [role='tab']:has-text('Holders')");
  await ana.waitForSelector("[data-holder-summary]");
  if (!/bonding curve/i.test(await ana.locator(".feed-body").innerText())) throw new Error("the curve is not labelled among the holders");
  await shot(ana, "14-coin");
});

await step("split withdrawal to a fresh address: uneven parts that add up, the first sent at once, the rest waiting and cancellable", async () => {
  await ben.goto(`${base}/wallet`);
  await ben.waitForSelector("#w-amount");
  await ben.click('.tabs button:text-is("withdraw")');
  await choose(ben, "w-coin", NATIVE);
  // A destination made here and never used: only its address and an encrypted backup file leave the wallet's worker.
  await ben.click("button:text-is('Make a fresh address for this')");
  await ben.fill("#w-fresh-password", "another long password");
  const [download] = await Promise.all([ben.waitForEvent("download"), ben.click("button:text-is('Make it and save the backup')")]);
  if (!/^ring-wallet-.+\.json$/.test(download.suggestedFilename())) throw new Error(`the backup was saved as ${download.suggestedFilename()}`);
  await ben.waitForFunction(() => document.querySelector("#w-to").value.length >= 32);
  const fresh = await ben.inputValue("#w-to");
  if (fresh === addresses.buyer) throw new Error("the fresh address is the wallet's own");
  if ((await onChain(fresh, NATIVE)) !== 0n) throw new Error("the fresh address already holds something");
  await ben.fill("#w-amount", "0.3");
  await choose(ben, "w-parts", "3");
  await choose(ben, "w-over", "600000");
  await ben.click("button:text-is('Review')");
  await ben.waitForSelector("table[data-planned] tbody tr");
  const planned = await ben.locator("table[data-planned] tbody tr td:nth-child(2)").allInnerTexts();
  const parts = planned.map((text) => units(NATIVE, text.replace(/[^0-9.]/g, "")));
  if (parts.length !== 3) throw new Error(`${parts.length} parts planned`);
  if (parts.reduce((sum, part) => sum + part, 0n) !== units(NATIVE, "0.3"))
    throw new Error(`the parts add up to ${parts.reduce((sum, part) => sum + part, 0n)}`);
  if (new Set(parts.map(String)).size === 1) throw new Error("the parts are all the same size");
  if (/already has a history/i.test(await ben.locator(".confirm").innerText())) throw new Error("a never-used address was called used");
  await clearTray(ben);
  await ben.click("button:text-is('Start the split withdrawal')");
  await ben.waitForSelector("[data-plans] tr[data-part='sent']", { timeout: 60000 });
  await landed(ben);
  const states = await ben.locator("[data-plans] tbody tr").evaluateAll((rows) => rows.map((row) => row.dataset.part));
  if (states.join() !== "sent,waiting,waiting") throw new Error(`the parts are ${states}`);
  // On the chain: the fresh address holds exactly the first part, and nothing else of the plan has moved.
  if ((await onChain(fresh, NATIVE)) !== parts[0]) throw new Error(`the fresh address holds ${await onChain(fresh, NATIVE)}, not the first part ${parts[0]}`);
  move("buyer", NATIVE, -parts[0]);
  move("buyer", NATIVE, -PAYOUT_FEE);
  // A reload keeps the plan; cancelling it stops the parts not yet sent.
  await ben.reload();
  await ben.waitForSelector("[data-plans] tr[data-part='waiting']");
  await ben.click("button:text-is('Cancel the parts not yet sent')");
  await ben.waitForSelector("[data-plans]", { state: "detached" });
  await walletMatches(ben, "buyer", NATIVE);
  if ((await onChain(fresh, NATIVE)) !== parts[0]) throw new Error("a cancelled part was sent");
});

await step("books balance: the escrow on the chain holds exactly what the Ring balances add up to, and the status page says so", async () => {
  for (const coin of coins) {
    const owed = (expected.seller[coin] ?? 0n) + (expected.buyer[coin] ?? 0n);
    const held = await onChain(escrow, coin);
    if (held !== owed) throw new Error(`${symbols[coin]}: escrow holds ${held}, Ring balances add up to ${owed}`);
  }
  const owedSol = expected.seller[NATIVE] + expected.buyer[NATIVE];
  if ((await onChain(escrow, NATIVE)) < owedSol) throw new Error("escrow holds less SOL than it owes");
  await ana.goto(`${base}/status`);
  await ana.waitForSelector("table.plain tbody tr");
  for (const coin of [NATIVE, ...coins]) {
    const row = ana.locator("table.plain tbody tr").filter({ has: ana.locator(`td:first-child:text-is("${symbols[coin]}")`) });
    const [held, owed, covered] = [
      await row.locator("td").nth(1).innerText(),
      await row.locator("td").nth(2).innerText(),
      await row.locator("td").nth(3).innerText(),
    ];
    if (held.trim() !== formatCoin(coin, await onChain(escrow, coin))) throw new Error(`${symbols[coin]} held reads ${held}`);
    if (owed.trim() !== formatCoin(coin, (expected.seller[coin] ?? 0n) + (expected.buyer[coin] ?? 0n))) throw new Error(`${symbols[coin]} owed reads ${owed}`);
    if (!/YES/i.test(covered)) throw new Error(`${symbols[coin]} is not covered`);
  }
  await shot(ana, "15-status");
});

await step("creator fees: the seller claims them into the Ring, and the escrow gains what the page said", async () => {
  await ana.goto(`${base}/coin/${mint}`);
  await ana.waitForFunction(() => /SOL to claim/i.test(document.querySelector("[data-claimable]")?.textContent ?? ""), null, { timeout: 20000 });
  // What the claim makes public is said beside the button.
  if (!/public either way/i.test(await ana.locator("[data-fees]").innerText())) throw new Error("the fee claim does not say what it makes public");
  const held = await onChain(escrow, NATIVE);
  await shot(ana, "16-fees-review");
  await clearTray(ana);
  await ana.click("[data-fees] button:text-is('Claim')");
  const said = await landed(ana);
  const claimed = /claimed ([\d.,<]+) SOL into your Ring balance/i.exec(said)?.[1];
  const gained = (await onChain(escrow, NATIVE)) - held;
  if (formatCoin(NATIVE, gained, 6) !== claimed) throw new Error(`the tray says "${said}", escrow gained ${formatCoin(NATIVE, gained)}`);
  move("seller", NATIVE, gained);
  await ana.goto(`${base}/wallet`);
  await walletMatches(ana, "seller", NATIVE);
});

await step("a reload keeps your place: the wallet's tab and the portfolio's wallet are in the address", async () => {
  await ben.goto(`${base}/wallet`);
  await ben.waitForSelector("#w-amount");
  await ben.click(".tabs button:text-is('transfer')");
  if (!ben.url().endsWith("#transfer")) throw new Error(`the address is ${ben.url()}`);
  await ben.reload();
  await ben.waitForSelector("#w-to");
  if ((await ben.locator(".tabs button[aria-pressed='true']").innerText()).trim().toLowerCase() !== "transfer") throw new Error("the tab was lost on reload");
  // A looked-up wallet stays in the portfolio's address, so the page can be reloaded or shared.
  await ben.goto(`${base}/portfolio#${addresses.seller}`);
  await ben.waitForSelector("[data-totals] .address");
  await ben.reload();
  await ben.waitForSelector("[data-totals] .address");
  if ((await ben.locator("[data-totals] .address").getAttribute("title")) !== addresses.seller) throw new Error("the looked-up wallet was lost on reload");
  await ben.goto(`${base}/wallet#nonsense`);
  await ben.waitForSelector("#w-amount");
  if ((await ben.locator(".tabs button[aria-pressed='true']").innerText()).trim().toLowerCase() !== "deposit")
    throw new Error("an unknown tab name did not fall back");
});

await step("the wallet locks and unlocks with the password; addresses keep their case", async () => {
  await ana.goto(`${base}/wallet`);
  await ana.waitForSelector(".kv .address");
  const shown = (await ana.locator(".kv .address").first().innerText()).trim();
  if (shown !== addresses.seller) throw new Error(`address shown as ${shown}`);
  await shot(ana, "17-seller-wallet");
  await ana.click("button:text-is('Lock')");
  await ana.waitForSelector("text=Unlock your wallet");
  await ana.fill("#wallet-password", "wrong password here");
  await ana.click("button:text-is('Unlock')");
  await ana.waitForFunction(() => /PASSWORD/i.test(document.querySelector(".status-line.bad")?.innerText ?? ""), null, { timeout: 30000 });
  await ana.fill("#wallet-password", PASSWORD);
  await ana.click("button:text-is('Unlock')");
  await ana.waitForSelector(".kv .address", { timeout: 30000 });
  await walletMatches(ana, "seller", mint);
});

await step("phone width: every app page fits without sideways scroll", async () => {
  await ben.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/wallet", "/explore", "/terminal", "/portfolio", `/coin/${mint}`, "/otc", "/pay", "/launch", "/status"]) {
    await ben.goto(base + path);
    await ben.waitForTimeout(1200);
    const overflow = await ben.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) throw new Error(`${path} overflows by ${overflow}px`);
    await ben.screenshot({ path: `shots/app/phone-${path.split("/")[1]}.png` });
  }
});

await browser.close();
const failed = results.filter(([result]) => result === "FAIL").length;
responses.sort((a, b) => b[0] - a[0]);
const slow = responses.filter(([waited]) => waited > 100);
console.log(`\nFirst word of status after a click: slowest ${responses[0]?.[0]} ms, over ${responses.length} actions. ${slow.length} took longer than 100 ms.`);
for (const [waited, selector] of slow) console.log(`   ${waited} ms after ${selector}`);
console.log(`${results.length - failed} of ${results.length} steps passed. Browser errors: ${errors.length}`);
for (const error of errors.slice(0, 12)) console.log("  ", error.slice(0, 240));
process.exit(failed || errors.length || slow.length ? 1 : 0);
