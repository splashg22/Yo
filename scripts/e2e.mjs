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
    window.__watch = new MutationObserver(() => {
      for (const line of document.querySelectorAll(".status-line")) {
        if (!line.innerText.trim()) continue;
        if (window.__clickedAt !== null) window.__answeredAt ??= performance.now();
        window.__said.push(line.innerText);
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
  await page.selectOption("#w-coin", mint);
  await page.fill("#w-amount", amount);
  if (to !== undefined) await page.fill("#w-to", to);
  if (memo !== undefined) await page.fill("#w-memo", memo);
  await page.click("button:text-is('Review')");
  await page.waitForSelector(".confirm .panel");
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
      const gained = (await onChain(addresses[who], NATIVE)) - before;
      if (gained !== 10_000_000_000n) throw new Error(`${who}: the chain gained ${gained} lamports, not exactly 10 SOL`);
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

await step("explore lists all three coins, newest first, each with a market cap and its Ring line", async () => {
  await ana.goto(`${base}/explore`);
  await ana.waitForSelector(".coins li");
  const rows = await ana.locator(".coins li").allInnerTexts();
  if (rows.length !== 3) throw new Error(`${rows.length} coins listed`);
  for (const text of rows)
    if (!/SOL/.test(text) || !/OF SUPPLY IN RING BALANCES/i.test(text) || !/1 WALLET HAS DEPOSITED IT/i.test(text)) throw new Error(text.replace(/\n/g, " | "));
  await ana.fill("#e-search", "ember");
  await settles(async () => String(await ana.locator(".coins li").count()), "1", "coins matching a search for ember");
  await ana.fill("#e-search", "no such coin");
  await ana.waitForSelector("text=No coin here matches");
  await ana.click("button:text-is('Show all')");
  await settles(async () => String(await ana.locator(".coins li").count()), "3", "coins after clearing the search");
  await ana.selectOption("#e-order", "cap");
  await shot(ana, "04-explore");
});

await step("curve trade, three buys and a sell: the wallet figure matches the chain after each", async () => {
  await ben.goto(`${base}/coin/${mint}`);
  await thrice(ben, ["0.03", "0.03", "0.03"], async (amount, index) => {
    await ben.waitForSelector("#t-amount");
    const before = await onChain(addresses.buyer, mint);
    await ben.fill("#t-amount", amount);
    await ben.click("button:text-is('Review')");
    await ben.waitForSelector(".confirm .panel");
    if (index === 0) await shot(ben, "05-buy-review");
    await press(ben, "text=Sign and buy", /bought/);
    if ((await onChain(addresses.buyer, mint)) <= before) throw new Error("the chain shows no more coins after the buy");
  });
  await ben.click(".tabs button:text-is('sell')");
  const before = await onChain(addresses.buyer, mint);
  await ben.fill("#t-amount", "1000");
  await ben.click("button:text-is('Review')");
  await press(ben, "text=Sign and sell", /sold/);
  if (before - (await onChain(addresses.buyer, mint)) !== units(mint, "1000")) throw new Error("the chain did not lose exactly 1,000 coins");
  await ben.goto(`${base}/wallet`);
  await walletMatches(ben, "buyer", mint);
  await walletMatches(ben, "buyer", NATIVE);
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
  if (!/FOR THE POSTER/i.test(await ben.locator("body").innerText())) throw new Error("the note is not in the history");
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
      await walletMatches(ben, "buyer", coin);
    },
  );
});

await step("OTC, three times: the seller offers a block, the buyer accepts, both sides settle together; one more is cancelled", async () => {
  await ana.goto(`${base}/otc`);
  await ben.goto(`${base}/otc`);
  await thrice(ana, ["100000", "100000", "100000"], async (amount, index) => {
    await ana.waitForSelector("#o-amount");
    await ana.selectOption("#o-coin", mint);
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
    await ana.selectOption("#p-coin", mint);
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

await step("privacy score, three times: the coin page's two figures are the chain's own", async () => {
  await ana.goto(`${base}/coin/${mint}`);
  await thrice(ana, [1, 2, 3], async () => {
    const [supply, inRing] = [await supplyOf(mint), await onChain(escrow, mint)];
    const want = `${formatShare(Number((inRing * 1_000_000n) / supply))} OF SUPPLY IN RING BALANCES 2 WALLETS HAVE DEPOSITED IT`;
    await settles(async () => (await ana.locator(".kv .badge").innerText()).replace(/\s+/g, " ").trim().toUpperCase(), want, "the Ring line");
    const served = (await app("coin", { mint })).coin?.privacy ?? (await app("coin", { mint })).privacy;
    if (BigInt(served.supply) !== supply || BigInt(served.inRing) !== inRing) throw new Error("the server's supply or Ring total is not the chain's");
    await ana.goto(`${base}/coin/${mint}`);
  });
  // The coin's history on the curve: its launch, three buys and a sell, each with a receipt.
  await settles(
    async () => String(await ana.locator("h2:text-is('Recent activity on the curve') ~ ul.events li a:text-is('Receipt')").count()),
    "5",
    "curve transactions listed",
  );
  await shot(ana, "14-coin");
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
  await ana.waitForFunction(() => /SOL TO CLAIM/i.test(document.body.innerText), null, { timeout: 20000 });
  const held = await onChain(escrow, NATIVE);
  await ana.locator(".form:has(h2) >> button:text-is('Review')").click();
  await ana.waitForSelector(".confirm .panel");
  await shot(ana, "16-fees-review");
  await press(ana, "text=Sign and claim", /claimed .* into your Ring balance/);
  const claimed = /CLAIMED ([\d.,<]+) SOL/i.exec(await ana.locator(".status-line").innerText())[1];
  const gained = (await onChain(escrow, NATIVE)) - held;
  if (formatCoin(NATIVE, gained, 6) !== claimed) throw new Error(`the page says ${claimed} SOL, escrow gained ${formatCoin(NATIVE, gained)}`);
  move("seller", NATIVE, gained);
  await ana.goto(`${base}/wallet`);
  await walletMatches(ana, "seller", NATIVE);
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
  for (const path of ["/wallet", "/explore", `/coin/${mint}`, "/otc", "/pay", "/launch", "/status"]) {
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
