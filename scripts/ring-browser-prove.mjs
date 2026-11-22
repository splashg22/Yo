// The real Privacy Rings program through this app's own wallet page, in a real browser, on devnet:
// make a wallet, register, deposit, transfer, withdraw, each read back from the page.
// Needs: a server in devnet mode (RING_NETWORK=devnet, HELIUS_API_KEY set) at CHECK_URL (default http://localhost:4712),
// and the funded test wallet made by `npm run ring:prove` (it pays the new browser wallet its test SOL).
// Run: npm run ring:browser        Devnet only. Evidence goes to .data-devnet/ring-browser.json.
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Connection, Keypair, PublicKey, SystemProgram, Transaction } = require("@solana/web3.js");

if (existsSync(".env")) process.loadEnvFile(".env");
const key = process.env.HELIUS_API_KEY ?? "";
if (!key) throw new Error("HELIUS_API_KEY is not set. Add it to .env.");
if (!existsSync(".data-devnet/prove-keys.json")) throw new Error("Run npm run ring:prove first: it makes and funds the test wallet that pays this one.");
const base = process.env.CHECK_URL ?? "http://localhost:4712";
const chain = new Connection(`https://devnet.helius-rpc.com/?api-key=${key}`, "confirmed");
const seeds = JSON.parse(readFileSync(".data-devnet/prove-keys.json", "utf8"));
const funder = Keypair.fromSeed(Uint8Array.from(seeds.a));
const NATIVE = "So11111111111111111111111111111111111111112";
const evidence = [];
const say = (line) => (evidence.push(line), console.log("   ", line));
const link = (signature) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

async function settled(signature) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const status = (await chain.getSignatureStatuses([signature])).value[0];
    if (status?.err) throw new Error(`failed on the chain: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("not confirmed within a minute");
}
const lamports = (address) => chain.getBalance(new PublicKey(address), "confirmed");

// The browser reaches Helius's signed enclave policy directly; on this machine that goes through the outbound proxy.
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
const browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
page.on("console", (message) => message.type() === "error" && errors.push(message.text().slice(0, 300)));
// What was refused or could not be reached: the first place to look when a step fails.
const refused = [];
const where = (url) => url.replace(/api-key=[^&]+/, "api-key=<key>").slice(0, 140);
page.on("response", (response) => response.status() >= 400 && refused.push(`${response.status()} ${where(response.url())}`));
page.on("requestfailed", (request) => refused.push(`${request.failure()?.errorText ?? "failed"} ${where(request.url())}`));
page.context().on("weberror", (error) => errors.push(String(error.error()).slice(0, 300)));
const outside = new Set();
page.on("request", (request) => {
  const host = new URL(request.url()).host;
  if (host !== new URL(base).host) outside.add(host);
});

const ringSol = async () => {
  const cell = page
    .locator("table.plain tbody tr")
    .filter({ has: page.locator('td:first-child:text-is("SOL")') })
    .locator("td")
    .nth(2);
  for (let attempt = 0; attempt < 200; attempt++) {
    const text = (await cell.innerText()).trim();
    if (!/reading/i.test(text)) return text;
    await page.waitForTimeout(150);
  }
  throw new Error("the page never showed a Ring balance");
};
/** Waits for the tray to say how the newest action ended, and returns its receipt's signature if it has one. */
async function landed(what) {
  await page.waitForFunction(() => ["confirmed", "failed", "expired"].includes([...document.querySelectorAll(".tray > div")].at(-1)?.dataset.state), null, {
    timeout: 180_000,
  });
  const last = page.locator(".tray > div").last();
  const text = (await last.innerText()).replace(/\s+/g, " ");
  if ((await last.getAttribute("data-state")) !== "confirmed") throw new Error(`${what}: the page says ${text}`);
  const receipt = await last
    .locator("a:text-is('Receipt')")
    .getAttribute("href")
    .catch(() => null);
  await page.evaluate(() => document.querySelectorAll(".tray button[aria-label='Dismiss']").forEach((button) => button.click()));
  return receipt ? receipt.split("/").pop() : null;
}
async function act(tab, { amount, to }) {
  await page.click(`.tabs button:text-is("${tab}")`);
  await page.click("#w-coin");
  await page.click(`[role="listbox"] [data-value="${NATIVE}"]`);
  await page.fill("#w-amount", amount);
  if (to !== undefined) await page.fill("#w-to", to);
  await page.click("button:text-is('Review')");
  await page.waitForSelector(".confirm .panel");
  const panel = (await page.locator(".confirm .panel").first().innerText()).replace(/\s+/g, " ");
  await page.click(`button:text-is("Sign and ${tab}")`);
  const signature = await landed(tab);
  return { signature, panel };
}

let answer = "not shown";
try {
  const config = await (await fetch(`${base}/api/config`, { method: "POST", body: "{}" })).json();
  if (config.network !== "devnet" || config.ring !== "real")
    throw new Error(`the server at ${base} is not in devnet mode with the real Ring: ${JSON.stringify(config)}`);
  await page.goto(`${base}/wallet`);
  await page.fill("#wallet-password", "a long test password");
  await page.fill("#wallet-password-again", "a long test password");
  await page.click("text=Create wallet");
  await page.waitForSelector(".kv .address", { timeout: 60_000 });
  const me = await page.locator(".kv .address").first().getAttribute("title");
  say(`A wallet made in the browser: ${me}`);

  // Test SOL for it, from the funded test wallet: a plain public transfer.
  const latest = await chain.getLatestBlockhash("confirmed");
  const fund = new Transaction({ feePayer: funder.publicKey, ...latest }).add(
    SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: new PublicKey(me), lamports: 200_000_000 }),
  );
  fund.sign(funder);
  const funded = await chain.sendRawTransaction(fund.serialize());
  await settled(funded);
  say(`Funded with 0.2 devnet SOL: ${link(funded)}`);

  // 1. Register.
  await page.reload();
  await page.fill("#wallet-password", "a long test password").catch(() => undefined);
  await page.click("button:text-is('Unlock')").catch(() => undefined);
  await page.waitForSelector("[data-register] button", { timeout: 90_000 });
  await page.click("[data-register] button");
  const registered = await landed("register");
  await page.waitForSelector("[data-register]", { state: "detached", timeout: 60_000 });
  say(`1. Registered from the page${registered ? `: ${link(registered)}` : ""}. The page no longer asks for registration.`);

  // 2. Deposit.
  const before = await ringSol();
  const deposit = await act("deposit", { amount: "0.05" });
  await page.waitForFunction(
    () => /0\.05/.test([...document.querySelectorAll("table.plain tbody tr")].find((row) => row.cells[0].innerText.trim() === "SOL")?.cells[2].innerText ?? ""),
    null,
    { timeout: 60_000 },
  );
  say(`2. Deposited 0.05 SOL: ${link(deposit.signature)}. Ring balance on the page: ${before} -> ${await ringSol()}`);
  say(`   The panel before signing said, of the server: "${/This site's server sees: (.*?) How it is done/.exec(deposit.panel)?.[1] ?? "?"}"`);

  // 3. Transfer, to the registered test wallet.
  const transfer = await act("transfer", { amount: "0.02", to: funder.publicKey.toBase58() });
  await page.waitForFunction(
    () => /0\.03/.test([...document.querySelectorAll("table.plain tbody tr")].find((row) => row.cells[0].innerText.trim() === "SOL")?.cells[2].innerText ?? ""),
    null,
    { timeout: 60_000 },
  );
  say(`3. Transferred 0.02 SOL to ${funder.publicKey.toBase58()}: ${link(transfer.signature)}. Ring balance on the page: ${await ringSol()}`);

  // 4. Withdraw, to the wallet's own address.
  const walletBefore = await lamports(me);
  const withdraw = await act("withdraw", { amount: "0.01", to: "" });
  await page.waitForFunction(
    () => /0\.02/.test([...document.querySelectorAll("table.plain tbody tr")].find((row) => row.cells[0].innerText.trim() === "SOL")?.cells[2].innerText ?? ""),
    null,
    { timeout: 60_000 },
  );
  const walletAfter = await lamports(me);
  say(
    `4. Withdrew 0.01 SOL: ${link(withdraw.signature)}. Ring balance on the page: ${await ringSol()}. The wallet on the chain: ${walletBefore} -> ${walletAfter} lamports`,
  );
  if (walletAfter - walletBefore < 9_900_000 || walletAfter - walletBefore > 10_000_000)
    throw new Error(`the wallet gained ${walletAfter - walletBefore} lamports, not 0.01 SOL less a fee`);

  const history = (await page.locator("table[data-history] tbody tr").allInnerTexts()).map((row) => row.replace(/\s+/g, " ").slice(0, 90));
  say(`History on the page, read with the wallet's own keys: ${history.length} rows: ${history.join(" | ")}`);
  say(`Hosts the page talked to other than this site: ${[...outside].join(", ") || "none"}`);
  say(`Browser errors: ${errors.length}${errors.length ? ` (${errors[0]})` : ""}`);
  answer = "Register, deposit, transfer and withdraw all went through this app's wallet page in a browser, on the real program";
} catch (error) {
  say(
    `FAILED: ${String(error instanceof Error ? error.message : error)
      .replaceAll(key, "<key>")
      .slice(0, 500)}`,
  );
  if (errors.length) say(`Browser errors: ${errors.slice(0, 3).join(" | ")}`);
  if (refused.length) say(`Refused or unreachable: ${[...new Set(refused)].slice(0, 6).join(" | ")}`);
  say(`Hosts the page talked to other than this site: ${[...outside].join(", ") || "none"}`);
  await page.screenshot({ path: ".data-devnet/ring-browser-failed.png" }).catch(() => undefined);
}
await browser.close();
writeFileSync(".data-devnet/ring-browser.json", JSON.stringify({ at: new Date().toISOString(), answer, evidence }, null, 2));
console.log(`\n${answer}\nEvidence saved to .data-devnet/ring-browser.json`);
process.exit(answer.startsWith("Register") ? 0 : 1);
