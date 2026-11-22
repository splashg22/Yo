// Launch B's own flow, on real devnet, through this app in a real browser: make a wallet, launch a coin on pump.fun's
// devnet program, see it on its page, buy some, sell some. Each result is read back from the chain.
// Needs: a server in devnet mode at CHECK_URL (default http://localhost:4712), and the funded test wallet of
// `npm run ring:prove` to pay the new browser wallet its test SOL. Devnet only: nothing here has any value.
// Run: npm run devnet:launch          Evidence: .data-devnet/devnet-launch.json
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Connection, Keypair, PublicKey, SystemProgram, Transaction } = require("@solana/web3.js");

if (existsSync(".env")) process.loadEnvFile(".env");
const key = process.env.HELIUS_API_KEY ?? "";
if (!key) throw new Error("HELIUS_API_KEY is not set. Add it to .env.");
const base = process.env.CHECK_URL ?? "http://localhost:4712";
const chain = new Connection(`https://devnet.helius-rpc.com/?api-key=${key}`, "confirmed");
const funder = Keypair.fromSeed(Uint8Array.from(JSON.parse(readFileSync(".data-devnet/prove-keys.json", "utf8")).a));
const evidence = [];
const say = (line) => (evidence.push(line), console.log("   ", line));
const link = (signature) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
async function readBack(signature) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const status = (await chain.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) return `FAILED on the chain: ${JSON.stringify(status.err)}`;
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized")
      return `on the chain, ${status.confirmationStatus}, slot ${status.slot}`;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return "the chain did not show it within a minute";
}
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
const browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
const landed = async (what) => {
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
  return { text, signature: receipt ? receipt.split("/").pop() : null };
};
let answer = "not shown";
try {
  const config = await (await fetch(`${base}/api/config`, { method: "POST", body: "{}" })).json();
  if (config.network !== "devnet") throw new Error(`the server at ${base} is not in devnet mode: ${JSON.stringify(config)}`);
  say(
    `Server: devnet, Ring ${config.ring}, features on: ${
      Object.entries(config.features)
        .filter(([, on]) => on)
        .map(([name]) => name)
        .join(", ") || "none"
    }`,
  );
  await page.goto(`${base}/wallet`);
  await page.fill("#wallet-password", "a long test password");
  await page.fill("#wallet-password-again", "a long test password");
  await page.click("text=Create wallet");
  await page.waitForSelector(".kv .address", { timeout: 60_000 });
  const me = await page.locator(".kv .address").first().getAttribute("title");
  const latest = await chain.getLatestBlockhash("confirmed");
  const fund = new Transaction({ feePayer: funder.publicKey, ...latest }).add(
    SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: new PublicKey(me), lamports: 55_000_000 }),
  );
  fund.sign(funder);
  const funded = await chain.sendRawTransaction(fund.serialize());
  say(`A wallet made in the browser, ${me}, funded with 0.055 devnet SOL: ${await readBack(funded)}`);
  const menu = (await page.locator(".top nav").innerText()).replace(/\s+/g, " ");
  say(`The menu on devnet: ${menu}`);
  if (/OTC|Pay/.test(menu)) throw new Error("OTC or Pay is in the menu on devnet");

  // 1. Launch a coin.
  await page.goto(`${base}/launch`);
  await page.waitForSelector("#l-name");
  const symbol = `T${Date.now().toString(36).slice(-5).toUpperCase()}`;
  await page.fill("#l-name", "Launch test");
  await page.fill("#l-symbol", symbol);
  await page.fill("#l-buy", "0.005");
  await page.click("button:text-is('Review')");
  await page.waitForSelector(".confirm .panel");
  await page.click("text=Sign and launch");
  const launch = await landed("launch");
  const mint = await page.evaluate(() => [...document.querySelectorAll("a[href^='/coin/']")].map((a) => a.getAttribute("href").slice(6))[0]);
  say(`1. Launched ${symbol} as ${mint}: ${launch.signature ? `${link(launch.signature)} (${await readBack(launch.signature)})` : launch.text}`);
  const mintInfo = await chain.getAccountInfo(new PublicKey(mint));
  if (!mintInfo) throw new Error("the coin's account is not on the chain");
  say(`   The coin's account on the chain: owned by ${mintInfo.owner.toBase58()}, ${mintInfo.data.length} bytes`);

  // 2. Its page, and a buy.
  await page.goto(`${base}/coin/${mint}`);
  await page.waitForSelector(".ticket", { timeout: 60_000 });
  await page.waitForSelector(".feed-body .vrow", { timeout: 60_000 });
  say(`2. Its page shows ${await page.locator(".feed-body .vrow").count()} trade(s), the first buy among them`);
  await page.fill("#t-amount", "0.005");
  await page.click(".ticket .go");
  const buy = await landed("buy");
  say(`3. Bought for 0.005 SOL: ${buy.signature ? `${link(buy.signature)} (${await readBack(buy.signature)})` : buy.text}`);
  // 3. A sell of part of it.
  await page.click(".ticket .sides .sell");
  await page.click(".ticket [data-preset='0']");
  await page.waitForTimeout(500);
  await page.click(".ticket .go");
  const sell = await landed("sell");
  say(`4. Sold a quarter: ${sell.signature ? `${link(sell.signature)} (${await readBack(sell.signature)})` : sell.text}`);
  await page.goto(`${base}/terminal`);
  await page.waitForSelector(`.coin-row[data-coin="${mint}"]`, { timeout: 60_000 });
  say(`5. The coin is on the board`);
  say(`Browser errors: ${errors.length}${errors.length ? ` (${errors[0]})` : ""}`);
  answer = "A coin was launched, bought and sold on devnet through this app in a browser";
} catch (error) {
  say(
    `FAILED: ${String(error instanceof Error ? error.message : error)
      .replaceAll(key, "<key>")
      .slice(0, 500)}`,
  );
  await page.screenshot({ path: ".data-devnet/devnet-launch-failed.png" }).catch(() => undefined);
}
await browser.close();
writeFileSync(".data-devnet/devnet-launch.json", JSON.stringify({ at: new Date().toISOString(), answer, evidence }, null, 2));
console.log(`\n${answer}`);
process.exit(answer.startsWith("A coin") ? 0 : 1);
