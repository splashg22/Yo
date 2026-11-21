// Tries to break the pages on purpose, in a browser: bad amounts, bad addresses, double
// clicks, a declined signature, a reload in the middle of an action, a frozen chain, a dead
// chain, a dead server, no wallet, an empty account. Each must give a clear message, and
// after all of it the escrow on the chain must still hold exactly what Ring balances add up to.
// Needs the validator, a server on PORT (default 4711), and one launched coin. Run: npm run break
import { execSync, spawn } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { NATIVE } from "../lib/constants.ts";
import { formatCoin, parseAmount } from "../lib/format.ts";
import { payLink } from "../lib/paylink.ts";

const { chromium } = createRequire(import.meta.url)("playwright");
const bs58 = createRequire(import.meta.url)("bs58").default;
const base = `http://127.0.0.1:${process.env.PORT ?? 4711}`;
const rpcUrl = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8799";
const PASSWORD = "correct horse battery";

async function rpc(method, params) {
  const body = await (
    await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })
  ).json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
async function onChain(owner, mint) {
  if (mint === NATIVE) return BigInt((await rpc("getBalance", [owner, { commitment: "confirmed" }])).value);
  const found = await rpc("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }]);
  return found.value.reduce((sum, account) => sum + BigInt(account.account.data.parsed.info.tokenAmount.amount), 0n);
}
const app = async (op, input = {}) =>
  (await fetch(`${base}/api/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) })).json();

const results = [];
async function check(label, run) {
  try {
    const detail = await run();
    results.push(["ok", label]);
    console.log("ok  ", label, detail ? `:: ${detail}` : "");
  } catch (error) {
    results.push(["FAIL", label]);
    console.log("FAIL", label, "::", String(error.message).split("\n")[0].slice(0, 300));
  }
}
const browser = await chromium.launch();
const unexpected = [];
async function open(init) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.on("pageerror", (error) => unexpected.push(String(error)));
  page.sent = [];
  // Only requests that build, send or move something: reading balances in the background does not count.
  page.on("request", (request) => {
    const name = request.url().split("/api/")[1] ?? "";
    if (request.method() === "POST" && /build|send|transfer|withdraw|offer|accept|cancel/.test(name)) page.sent.push(name);
  });
  return page;
}
async function makeWallet(page, faucets = 1) {
  await page.goto(`${base}/wallet`);
  await page.fill("#wallet-password", PASSWORD);
  await page.fill("#wallet-password-again", PASSWORD);
  await page.click("text=Create wallet");
  await page.waitForSelector(".kv .address", { timeout: 30000 });
  const address = await page.locator(".kv .address").first().getAttribute("title");
  for (let index = 0; index < faucets; index++) await app("faucet", { wallet: address });
  await page.reload();
  await page.waitForSelector("#w-amount");
  return address;
}
/** The message a refused form or a failed action shows. Empty if the page said nothing. */
const complaint = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[role=alert], .status-line.bad")]
      .map((el) => el.innerText.trim())
      .filter(Boolean)
      .join(" / "),
  );
async function waitForComplaint(page, timeout = 30000) {
  await page.waitForFunction(() => [...document.querySelectorAll("[role=alert], .status-line.bad")].some((el) => el.innerText.trim()), null, { timeout });
  return complaint(page);
}
async function fillWallet(page, tab, { mint = NATIVE, amount, to }) {
  if (await page.locator(".confirm").count()) await page.click("button:text-is('Back')");
  await page.click(`.tabs button:text-is("${tab}")`);
  await page.selectOption("#w-coin", mint);
  await page.fill("#w-amount", amount);
  if (to !== undefined) await page.fill("#w-to", to);
  await page.click("button:text-is('Review')");
}
/** Waits until a wallet has published a note key. */
async function settlesNoteKey(wallet) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await app("ring/note-key", { wallet })).key) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("the wallet extension never published a note key");
}
const ringCell = async (page, symbol) =>
  (
    await page
      .locator("table.plain tbody tr")
      .filter({ has: page.locator(`td:first-child:text-is("${symbol}")`) })
      .locator("td")
      .nth(2)
      .innerText()
  ).trim();
const escrow = (await app("status")).escrowAddress;
const [coin] = (await app("explore")).coins;
if (!coin) throw new Error("Launch a coin first (npm run e2e).");

const page = await open();
const me = await makeWallet(page, 1);

// ---- amounts -----------------------------------------------------------------------------
const BAD_AMOUNTS = [
  ["", /enter an amount/i],
  ["0", /above zero/i],
  ["0.0000000000", /decimal places|above zero/i],
  ["0.0000000001", /decimal places/i],
  ["-1", /enter an amount/i],
  ["1e5", /enter an amount/i],
  ["abc", /enter an amount/i],
  ["1.2.3", /enter an amount/i],
  ["99999999999999999999", /larger than the chain can hold/i],
  ["١٢٣", /enter an amount/i],
];
await check("bad amounts in every money form are refused in the form, with a reason, before anything is built", async () => {
  for (const tab of ["deposit", "transfer", "withdraw"]) {
    for (const [amount, reason] of BAD_AMOUNTS) {
      page.sent.length = 0;
      await fillWallet(page, tab, { amount, to: tab === "transfer" ? escrow : undefined });
      const said = await complaint(page);
      if (!reason.test(said)) throw new Error(`${tab} "${amount}": said "${said}"`);
      if (await page.locator(".confirm").count()) throw new Error(`${tab} "${amount}" reached the confirm step`);
      if (page.sent.length) throw new Error(`${tab} "${amount}" sent ${page.sent}`);
    }
  }
  await page.goto(`${base}/coin/${coin.mint}`);
  await page.waitForSelector("#t-amount");
  for (const [amount, reason] of BAD_AMOUNTS) {
    await page.fill("#t-amount", amount);
    await page.click("button:text-is('Review')");
    const said = await complaint(page);
    if (!reason.test(said)) throw new Error(`buy "${amount}": said "${said}"`);
  }
  for (const [path, field, others] of [
    ["/launch", "#l-buy", { "#l-name": "Lantern", "#l-symbol": "LNT" }],
    ["/otc", "#o-amount", { "#o-price": "1", "#o-buyer": escrow }],
    ["/otc", "#o-price", { "#o-amount": "1", "#o-buyer": escrow }],
  ]) {
    await page.goto(base + path);
    await page.waitForSelector(field);
    for (const [amount, reason] of BAD_AMOUNTS.slice(field === "#l-buy" ? 1 : 0)) {
      for (const [selector, value] of Object.entries(others)) await page.fill(selector, value);
      await page.fill(field, amount);
      await page.click("button:text-is('Review')");
      const said = await complaint(page);
      if (!reason.test(said)) throw new Error(`${path} ${field} "${amount}": said "${said}"`);
    }
  }
  return `${BAD_AMOUNTS.length} bad amounts x 7 fields`;
});

await check("the smallest and largest real amounts behave: one base unit deposits; more than the wallet holds is refused with a reason", async () => {
  await page.goto(`${base}/wallet`);
  await page.waitForSelector("#w-amount");
  const before = await onChain(escrow, NATIVE);
  await fillWallet(page, "deposit", { amount: "0.000000001" });
  await page.click("text=Sign and deposit");
  await page.waitForFunction(() => /deposited/i.test(document.querySelector(".status-line")?.innerText ?? ""), null, { timeout: 60000 });
  if ((await onChain(escrow, NATIVE)) - before !== 1n) throw new Error("one lamport did not arrive as one lamport");
  if ((await ringCell(page, "SOL")) !== "0.000000001") throw new Error(`the Ring shows ${await ringCell(page, "SOL")}`);
  await fillWallet(page, "deposit", { amount: "18446744073.709551615" });
  await page.click("text=Sign and deposit");
  const said = await waitForComplaint(page);
  if (!/not enough in the wallet/i.test(said)) throw new Error(said);
  await fillWallet(page, "withdraw", { amount: "5" });
  await page.click("text=Sign and withdraw");
  const low = await waitForComplaint(page);
  if (!/too low|does not cover/i.test(low)) throw new Error(low);
});

// ---- addresses ---------------------------------------------------------------------------
await check("wrong and malformed addresses are refused with a reason, and nothing moves", async () => {
  await page.goto(`${base}/wallet`);
  await page.waitForSelector("#w-amount");
  const held = await ringCell(page, "SOL");
  const stranger = "4Nd1mYQzKzS9hQ4f1mVJ8XhQmTqzZ5y8X3kq1n2uUo7B"; // a valid address that never registered
  for (const [to, reason] of [
    ["", /recipient|address/i],
    ["not an address", /valid Solana address/i],
    [bs58.encode(new Uint8Array(31).fill(7)), /valid Solana address/i], // one byte short
    [bs58.encode(new Uint8Array(33).fill(7)), /valid Solana address/i], // one byte long
    [me.replace(/[1-9A-HJ-NP-Za-km-z]/, "0"), /valid Solana address/i],
    ["0x52908400098527886E0F7030069857D2E4169EE7", /valid Solana address/i],
    [stranger, /not registered|has not/i],
    [me, /yourself|your own/i],
  ]) {
    await fillWallet(page, "transfer", { amount: "0.000000001", to });
    if (await page.locator(".confirm").count()) await page.click("text=Sign and transfer");
    const said = await waitForComplaint(page);
    if (!reason.test(said)) throw new Error(`to "${to.slice(0, 20)}": said "${said}"`);
  }
  await page.reload();
  await page.waitForSelector("#w-amount");
  if ((await ringCell(page, "SOL")) !== held) throw new Error("a refused transfer changed the balance");
});

// ---- double clicks -----------------------------------------------------------------------
await check("a double click on Sign sends one transaction and moves the money once", async () => {
  const before = await onChain(escrow, NATIVE);
  await fillWallet(page, "deposit", { amount: "0.5" });
  page.sent.length = 0;
  await page.dblclick("text=Sign and deposit");
  await page
    .locator(".confirm .btn")
    .click({ force: true, timeout: 1000 })
    .catch(() => undefined);
  await page.waitForFunction(() => /deposited/i.test(document.querySelector(".status-line")?.innerText ?? ""), null, { timeout: 60000 });
  const sends = page.sent.filter((name) => name === "tx/send").length;
  if (sends !== 1) throw new Error(`${sends} transactions were sent`);
  if ((await onChain(escrow, NATIVE)) - before !== 500_000_000n) throw new Error("escrow did not gain exactly 0.5 SOL");
  // The same for an action that needs no transaction: a Ring transfer signed twice by a fast finger.
  const other = await open();
  const friend = await makeWallet(other, 0);
  await fillWallet(page, "transfer", { amount: "0.1", to: friend });
  page.sent.length = 0;
  await page.dblclick("text=Sign and transfer");
  await page.waitForFunction(() => /sent/i.test(document.querySelector(".status-line")?.innerText ?? ""), null, { timeout: 30000 });
  if (page.sent.filter((name) => name === "ring/transfer").length !== 1) throw new Error("the transfer was requested more than once");
  await other.reload();
  await other.waitForFunction(
    () =>
      document.querySelectorAll("table.plain tbody td:nth-child(3)").length > 0 &&
      [...document.querySelectorAll("table.plain tbody td:nth-child(3)")].every((cell) => !/reading/i.test(cell.innerText)),
  );
  if ((await ringCell(other, "SOL")) !== "0.1") throw new Error(`the recipient holds ${await ringCell(other, "SOL")}`);
  await other.context().close();
});

// ---- two tabs -----------------------------------------------------------------------------
await page.goto(`${base}/wallet`);
await page.waitForSelector("#w-amount");
await check("two tabs on one wallet: a deposit made in one shows in the other when you return to it, and both keep working", async () => {
  const second = await page.context().newPage();
  await second.goto(`${base}/wallet`);
  // A new tab shares the encrypted wallet but not the unlocked key: it asks for the password.
  await second.waitForSelector("text=Unlock your wallet");
  await second.fill("#wallet-password", PASSWORD);
  await second.click("button:text-is('Unlock')");
  await second.waitForSelector("#w-amount", { timeout: 30000 });
  await second.waitForFunction(
    () =>
      document.querySelectorAll("table.plain tbody td:nth-child(3)").length > 0 &&
      [...document.querySelectorAll("table.plain tbody td:nth-child(3)")].every((cell) => !/reading/i.test(cell.innerText)),
  );
  const before = await ringCell(second, "SOL");
  await page.bringToFront();
  await fillWallet(page, "deposit", { amount: "0.3" });
  await page.click("text=Sign and deposit");
  await page.waitForFunction(() => /deposited/i.test(document.querySelector(".status-line")?.innerText ?? ""), null, { timeout: 60000 });
  const after = await ringCell(page, "SOL");
  if (after === before) throw new Error("the first tab did not change");
  await second.bringToFront();
  await second.evaluate(() => window.dispatchEvent(new Event("focus")));
  await second.waitForFunction(
    (want) =>
      [...document.querySelectorAll("table.plain tbody tr")].some((row) => row.cells[0].innerText.trim() === "SOL" && row.cells[2].innerText.trim() === want),
    after,
    { timeout: 15000 },
  );
  // The second tab is not left with a stale view of what it can spend: it withdraws what the first deposited.
  await fillWallet(second, "withdraw", { amount: "0.3" });
  await second.click("text=Sign and withdraw");
  await second.waitForFunction(() => /withdrew/i.test(document.querySelector(".status-line")?.innerText ?? ""), null, { timeout: 60000 });
  await second.close();
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(
    (want) =>
      [...document.querySelectorAll("table.plain tbody tr")].some((row) => row.cells[0].innerText.trim() === "SOL" && row.cells[2].innerText.trim() === want),
    // Back where it started, less the network fee for the payout, which the withdrawing wallet pays.
    formatCoin(NATIVE, parseAmount(before, 9) - 5_000n),
    { timeout: 15000 },
  );
});

// ---- awkward names ---------------------------------------------------------------------------
await check("a coin with the longest name and ticker allowed, and names that cannot be shown: pages still fit; bad names are refused", async () => {
  await page.goto(`${base}/launch`);
  for (const [name, reason] of [
    ["Lan\u0000tern", /cannot be shown/i],
    ["\u202Egnp.exe", /cannot be shown/i],
  ]) {
    await page.fill("#l-name", name);
    await page.fill("#l-symbol", "ODD");
    await page.click("button:text-is('Review')");
    if (await page.locator(".confirm").count()) await page.click("text=Sign and launch");
    const said = await waitForComplaint(page);
    if (!reason.test(said)) throw new Error(`name ${JSON.stringify(name)}: ${said}`);
    await page.goto(`${base}/launch`);
  }
  await page.fill("#l-name", "W".repeat(32));
  await page.fill("#l-symbol", "W".repeat(10));
  await page.click("button:text-is('Review')");
  await page.click("text=Sign and launch");
  await page.waitForSelector("text=is on the curve and registered with the Ring", { timeout: 60000 });
  const wide = await page.locator(".kv .address").first().getAttribute("title");
  const phone = await browser.newPage({ viewport: { width: 320, height: 640 } });
  for (const path of ["/explore", `/coin/${wide}`, "/wallet"]) {
    await phone.goto(base + path);
    await phone.waitForTimeout(1500);
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) throw new Error(`${path} is ${overflow}px too wide with a 32-letter name`);
    // Nothing a finger needs may sit past the edge, even where the page itself does not scroll sideways.
    const lost = await phone.evaluate(() =>
      [...document.querySelectorAll("main a, main button, main input, main select")]
        .filter((el) => el.getClientRects().length && (el.getBoundingClientRect().right > innerWidth + 1 || el.getBoundingClientRect().left < -1))
        .map((el) => el.innerText || el.id)
        .slice(0, 3),
    );
    if (lost.length) throw new Error(`${path}: controls off the screen with a 32-letter name: ${lost.join(", ")}`);
  }
  await phone.close();
  await page.goto(`${base}/wallet`);
  await page.waitForSelector("#w-amount");
});

// ---- reload mid-action ---------------------------------------------------------------------
await check("a reload in the middle of a deposit loses nothing: the chain and the Ring agree afterwards", async () => {
  const [walletBefore, escrowBefore] = [await onChain(me, NATIVE), await onChain(escrow, NATIVE)];
  await fillWallet(page, "deposit", { amount: "0.25" });
  const sent = page.waitForRequest((request) => request.url().endsWith("/api/tx/send"));
  await page.click("text=Sign and deposit");
  await sent;
  await page.reload(); // the browser never hears the answer
  await page.waitForSelector("#w-amount");
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const moved = (await onChain(escrow, NATIVE)) - escrowBefore;
  if (moved !== 0n && moved !== 250_000_000n) throw new Error(`escrow moved by ${moved}`);
  await page.click("text=Check for anything missing");
  await page.waitForFunction(() => /nothing was missing|recovered/i.test(document.querySelector(".status-line")?.innerText ?? ""), null, { timeout: 30000 });
  const status = await app("status");
  const sol = status.escrow.find((row) => row.mint === NATIVE);
  if (!sol.covered) throw new Error("escrow no longer covers what it owes");
  const spent = walletBefore - (await onChain(me, NATIVE));
  if (moved === 0n ? spent !== 0n : spent < 250_000_000n) throw new Error(`the wallet spent ${spent} but escrow gained ${moved}`);
  return moved === 0n ? "the transaction never landed; nothing moved" : "the transaction landed and was credited without the browser";
});

// ---- a frozen chain mid-action ---------------------------------------------------------------
await check("a chain that freezes for five seconds mid-deposit: the action finishes or says why, and the books still balance", async () => {
  const validator = execSync("pgrep -x solana-test-val | head -1").toString().trim(); // the process name, as the system shortens it
  await fillWallet(page, "deposit", { amount: "0.125" });
  await page.click("text=Sign and deposit");
  execSync(`kill -STOP ${validator}`);
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const during = await page.evaluate(() => document.querySelector(".status-line")?.innerText ?? "");
  execSync(`kill -CONT ${validator}`);
  if (!/waiting for the chain/i.test(during)) throw new Error(`while frozen the page said "${during}"`);
  await page.waitForFunction(() => /deposited|expired|not answering|try again/i.test(document.querySelector(".status-line")?.innerText ?? ""), null, {
    timeout: 90000,
  });
  const said = await page.evaluate(() => document.querySelector(".status-line").innerText);
  await app("ring/reconcile");
  if (!(await app("status")).escrow.every((row) => row.covered)) throw new Error("escrow no longer covers what it owes");
  return said;
});

// ---- declined signature (an extension wallet that says no) ------------------------------------
await check("a wallet that declines to sign: the page says so, says nothing was sent, and sends nothing", async () => {
  const declining = await open(async () => {
    if (!crypto.subtle) return; // the blank page a tab starts on
    const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let number = publicKey.reduce((sum, byte) => sum * 256n + BigInt(byte), 0n);
    let address = "";
    while (number > 0n) ((address = alphabet[Number(number % 58n)] + address), (number /= 58n));
    for (const byte of publicKey)
      if (byte === 0) address = `1${address}`;
      else break;
    const account = { address, publicKey, chains: ["solana:localnet"], features: ["solana:signMessage", "solana:signTransaction"] };
    const wallet = {
      version: "1.0.0",
      name: "Stubborn Wallet",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
      chains: ["solana:localnet"],
      accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "standard:events": { version: "1.0.0", on: () => () => undefined },
        "solana:signMessage": {
          version: "1.0.0",
          signMessage: async ({ message }) => {
            if (window.__decline) throw new Error("User rejected the request.");
            return [{ signedMessage: message, signature: new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, message)) }];
          },
        },
        "solana:signTransaction": {
          version: "1.0.0",
          signTransaction: async () => {
            throw new Error("User rejected the request.");
          },
        },
      },
    };
    const announce = () => window.dispatchEvent(Object.assign(new Event("wallet-standard:register-wallet"), { detail: ({ register }) => register(wallet) }));
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
    announce();
  });
  await declining.goto(`${base}/wallet`);
  await declining.click("button:text-is('Stubborn Wallet')", { timeout: 15000 });
  await declining.waitForSelector("#w-amount", { timeout: 15000 });
  const address = await declining.locator(".kv .address").first().getAttribute("title");
  await app("faucet", { wallet: address });
  // Connecting asked the extension for one extra signature, which gave it a note key. A note sent to it can be read there.
  await settlesNoteKey(address);
  await page.bringToFront();
  await page.goto(`${base}/wallet`);
  await page.waitForSelector("#w-amount");
  await fillWallet(page, "transfer", { amount: "0.001", to: address });
  await page.click("button:text-is('Back')");
  await page.fill("#w-memo", "hello extension");
  await page.click("button:text-is('Review')");
  await page.click("text=Sign and transfer");
  await page.waitForFunction(() => /sent/i.test(document.querySelector(".status-line")?.innerText ?? ""), null, { timeout: 30000 });
  await declining.bringToFront();
  await declining.click("text=Check for anything missing");
  await declining.waitForFunction(() => /READABLE ONLY BY YOU AND THE OTHER WALLET: "HELLO EXTENSION"/i.test(document.body.innerText), null, {
    timeout: 20000,
  });
  declining.sent.length = 0;
  await fillWallet(declining, "deposit", { amount: "1" });
  await declining.click("text=Sign and deposit");
  const said = await waitForComplaint(declining);
  if (!/did not sign/i.test(said) || !/nothing was sent/i.test(said)) throw new Error(said);
  if (declining.sent.includes("tx/send")) throw new Error("a transaction was sent anyway");
  await declining.evaluate(() => (window.__decline = true));
  await fillWallet(declining, "transfer", { amount: "1", to: me });
  declining.sent.length = 0;
  await declining.click("text=Sign and transfer");
  const refused = await waitForComplaint(declining);
  if (!/did not sign/i.test(refused)) throw new Error(refused);
  if (declining.sent.includes("ring/transfer")) throw new Error("the transfer was requested anyway");
  if ((await onChain(address, NATIVE)) !== 10_000_000_000n) throw new Error("the wallet's balance changed");
  await declining.context().close();
  return said;
});

// ---- no wallet, empty account ---------------------------------------------------------------
await check("no wallet: every page that moves money asks for one instead of failing; a pay link still shows what is asked", async () => {
  const visitor = await open();
  for (const path of ["/launch", "/wallet", "/otc", "/pay", `/coin/${coin.mint}`]) {
    await visitor.goto(base + path);
    await visitor.waitForSelector("text=No wallet needed", { timeout: 15000 });
  }
  await visitor.goto(payLink(base, { to: me, mint: NATIVE, amount: "1500000000" }));
  await visitor.waitForSelector(".gate");
  if (!/asked to pay/i.test(await visitor.locator("h1").innerText())) throw new Error("the pay link did not show a request");
  if (unexpected.length) throw new Error(unexpected[0]);
  await visitor.context().close();
});

await check("an empty account: every action explains what is missing", async () => {
  const empty = await open();
  await makeWallet(empty, 0);
  const tried = [];
  for (const [tab, extra] of [
    ["deposit", {}],
    ["withdraw", {}],
    ["transfer", { to: me }],
  ]) {
    await fillWallet(empty, tab, { amount: "1", ...extra });
    await empty.click(`text=Sign and ${tab}`);
    const said = await waitForComplaint(empty);
    if (!/not enough in the wallet|too low|nothing in/i.test(said)) throw new Error(`${tab}: ${said}`);
    tried.push(said);
  }
  await empty.goto(`${base}/coin/${coin.mint}`);
  await empty.waitForSelector("#t-amount");
  await empty.fill("#t-amount", "0.01");
  await empty.click("button:text-is('Review')");
  await empty.click("text=Sign and buy");
  const buy = await waitForComplaint(empty);
  if (!/not enough in the wallet/i.test(buy)) throw new Error(`buy: ${buy}`);
  await empty.click("button:text-is('Back')");
  await empty.click(".tabs button:text-is('sell')");
  await empty.fill("#t-amount", "5");
  await empty.click("button:text-is('Review')");
  if (await empty.locator(".confirm").count()) await empty.click("text=Sign and sell");
  const sell = await waitForComplaint(empty);
  if (!/hold none|hold less|you hold/i.test(sell)) throw new Error(`sell: ${sell}`);
  await empty.goto(`${base}/launch`);
  await empty.fill("#l-name", "Lantern");
  await empty.fill("#l-symbol", "LNT");
  await empty.click("button:text-is('Review')");
  await empty.click("text=Sign and launch");
  const launch = await waitForComplaint(empty);
  if (!/not enough in the wallet/i.test(launch)) throw new Error(`launch: ${launch}`);
  await empty.context().close();
  return [...new Set([...tried, buy, sell])].join(" | ");
});

// ---- dead server, dead chain -----------------------------------------------------------------
await check("the site's own server stops answering: pages say so and offer a retry; an action in flight says nothing was sent", async () => {
  await page.goto(`${base}/wallet`);
  await page.waitForSelector("#w-amount");
  await page.route("**/api/**", (route) => route.abort());
  await fillWallet(page, "deposit", { amount: "0.1" });
  await page.click("text=Sign and deposit");
  const said = await waitForComplaint(page);
  if (!/server is not answering/i.test(said)) throw new Error(said);
  for (const path of ["/explore", "/status", `/coin/${coin.mint}`, "/wallet", "/otc"]) {
    await page.goto(base + path);
    const text = await waitForComplaint(page, 15000);
    if (!/not answering|could not be/i.test(text)) throw new Error(`${path}: ${text}`);
  }
  await page.unroute("**/api/**");
  await page.goto(`${base}/explore`);
  await page.waitForSelector(".coins li");
  return said;
});

await check("the chain stops answering: a second server pointed at a dead address explains it on every page within its time limit", async () => {
  const port = 4712;
  cpSync(".data", ".data-dead", { recursive: true }); // the same coins and balances, so there is something the chain is needed for
  const server = spawn("npx", ["next", "start", "-p", String(port)], {
    env: { ...process.env, LOCAL_RPC_URL: "http://127.0.0.1:1", RPC_TIMEOUT_MS: "1500", APP_DATA_DIR: ".data-dead" },
    stdio: "ignore",
    detached: true,
  });
  try {
    const dead = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (
        await fetch(`${dead}/api/config`, { method: "POST", body: "{}" }).then(
          (r) => r.ok,
          () => false,
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const visitor = await open();
    const heard = [];
    for (const path of ["/status", "/explore", `/coin/${coin.mint}`]) {
      const started = Date.now();
      await visitor.goto(dead + path);
      // The status page states it in its own row; the others raise a notice.
      await visitor
        .waitForFunction(() => /not answering|could not be reached/i.test(document.querySelector("main").innerText), null, { timeout: 20000 })
        .catch(() => undefined);
      const text = await visitor.locator("main").innerText();
      if (!/not answering|could not be reached|cannot reach|unreachable/i.test(text)) throw new Error(`${path}: ${text.replace(/\s+/g, " ").slice(0, 200)}`);
      heard.push(`${path} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }
    await visitor.goto(`${dead}/wallet`);
    await visitor.fill("#wallet-password", PASSWORD);
    await visitor.fill("#wallet-password-again", PASSWORD);
    await visitor.click("text=Create wallet");
    await visitor.waitForSelector("#w-amount", { timeout: 30000 });
    await fillWallet(visitor, "deposit", { amount: "1" });
    await visitor.click("text=Sign and deposit");
    const said = await waitForComplaint(visitor);
    if (!/chain is not answering|could not be reached|nothing was sent/i.test(said)) throw new Error(`deposit: ${said}`);
    await visitor.context().close();
    return `${heard.join(", ")}; deposit: ${said}`;
  } finally {
    process.kill(-server.pid);
    rmSync(".data-dead", { recursive: true, force: true });
  }
});

// ---- after all of that -----------------------------------------------------------------------
await check("after everything above, escrow on the chain still covers every Ring balance, and no payout is stuck", async () => {
  await app("ring/reconcile");
  const status = await app("status");
  for (const row of status.escrow) {
    const held = await onChain(escrow, row.mint);
    if (held.toString() !== row.held) throw new Error(`status says escrow holds ${row.held} of ${row.mint}, the chain says ${held}`);
    if (held < BigInt(row.owed)) throw new Error(`${row.mint}: holds ${formatCoin(row.mint, held)}, owes ${formatCoin(row.mint, row.owed)}`);
    if (row.mint !== NATIVE && held !== BigInt(row.owed)) throw new Error(`${row.mint}: escrow and ledger differ`);
  }
  if (status.pendingPayouts !== 0) throw new Error(`${status.pendingPayouts} payouts are still pending`);
  if (unexpected.length) throw new Error(`page errors: ${unexpected.slice(0, 2).join(" | ")}`);
});

await browser.close();
const failed = results.filter(([result]) => result === "FAIL").length;
console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
