// Drives the real pages in a browser, as two people, against the local validator:
// make wallets, launch, trade, deposit, transfer, withdraw, OTC, pay link.
// Needs the validator and `npm run start -- -p 3311`. Run: npm run e2e
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const base = `http://127.0.0.1:${process.env.PORT ?? 3311}`;
mkdirSync("shots/app", { recursive: true });

const browser = await chromium.launch();
const results = [];
const errors = [];
async function person(name) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
  page.on("console", (m) => { if (m.type() === "error" && !/400 \(Bad Request\)/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  return page;
}
const status = (page) => page.locator(".status-line").last();
async function step(label, run) {
  try { await run(); results.push(["ok", label]); console.log("ok  ", label); }
  catch (error) { results.push(["FAIL", label]); console.log("FAIL", label, "::", String(error.message).split("\n")[0].slice(0, 200)); }
}
const shot = (page, name) => page.screenshot({ path: `shots/app/${name}.png` });
async function makeWallet(page) {
  await page.goto(`${base}/wallet`);
  await page.fill("#wallet-password", "correct horse battery");
  await page.fill("#wallet-password-again", "correct horse battery");
  await page.click("text=Create wallet");
  await page.waitForSelector(".kv .address", { timeout: 30000 });
  const address = await page.locator(".kv .address").first().getAttribute("title");
  await page.click("text=Get test SOL");
  await page.waitForFunction(() => document.body.innerText.includes("10 TEST SOL ADDED") || document.body.innerText.includes("10 test SOL added"), null, { timeout: 30000 });
  return address;
}
async function walletAction(page, tab, { coin, amount, to, memo }) {
  await page.goto(`${base}/wallet`);
  await page.waitForSelector("#w-coin");
  await page.click(`.tabs button:has-text("${tab}")`);
  if (coin) await page.selectOption("#w-coin", { label: coin });
  await page.fill("#w-amount", amount);
  if (to) await page.fill("#w-to", to);
  if (memo) await page.fill("#w-memo", memo);
  await page.click("text=Review");
  await page.waitForSelector(".confirm .panel");
  return page;
}
const ringCell = (page, coin) => page.locator(`table.plain tr:has(td:text-is("${coin}")) td`).nth(2);

const ana = await person("seller"), ben = await person("buyer");
let anaAddress, benAddress, mint;

await step("a wallet is made in the browser, with no extension, and funded", async () => {
  anaAddress = await makeWallet(ana);
  benAddress = await makeWallet(ben);
  if (!anaAddress || anaAddress === benAddress) throw new Error("no address");
  await shot(ana, "01-wallet");
});

await step("launch: create on the curve + register with the Ring + first buy into the Ring, one signature", async () => {
  await ana.goto(`${base}/launch`);
  await ana.fill("#l-name", "Lantern"); await ana.fill("#l-symbol", "LNTRN"); await ana.fill("#l-buy", "0.05");
  await ana.click("text=Review");
  await ana.waitForSelector(".confirm .panel");
  if ((await ana.locator(".confirm .panel").count()) !== 3) throw new Error("expected three privacy panels: launch, curve trade, deposit");
  await shot(ana, "02-launch-review");
  await ana.click("text=Sign and launch");
  await ana.waitForSelector("text=is on the curve and registered with the Ring", { timeout: 60000 });
  mint = await ana.locator(".kv .address").first().getAttribute("title");
  await shot(ana, "03-launched");
});

await step("explore lists the coin with its market cap and Ring line", async () => {
  await ana.goto(`${base}/explore`);
  await ana.waitForSelector(".coins li");
  const text = await ana.locator(".coins li").first().innerText();
  if (!/LANTERN/i.test(text) || !/SOL/.test(text) || !/OF SUPPLY IN RING BALANCES/i.test(text) || !/1 WALLET HAS DEPOSITED IT/i.test(text)) throw new Error(text.replace(/\n/g, " | "));
  await shot(ana, "04-explore");
});

await step("the buyer buys on the public curve", async () => {
  await ben.goto(`${base}/coin/${mint}`);
  await ben.waitForSelector("#t-amount");
  await ben.fill("#t-amount", "0.1");
  await ben.click("text=Review");
  await ben.waitForSelector(".confirm .panel");
  await shot(ben, "05-buy-review");
  await ben.click("text=Sign and buy");
  await ben.waitForFunction(() => /BOUGHT ABOUT/i.test(document.body.innerText), null, { timeout: 60000 });
});

await step("deposit: the buyer moves SOL and the coin into the Ring", async () => {
  await walletAction(ben, "deposit", { amount: "3" });
  await shot(ben, "06-deposit-review");
  await ben.click("text=Sign and deposit");
  await ben.waitForFunction(() => /DEPOSITED\./i.test(document.body.innerText), null, { timeout: 60000 });
  await walletAction(ben, "deposit", { coin: "LNTRN", amount: "1000000" });
  await ben.click("text=Sign and deposit");
  await ben.waitForFunction(() => /DEPOSITED\./i.test(document.body.innerText), null, { timeout: 60000 });
  await ben.waitForFunction(() => [...document.querySelectorAll("table.plain tr")].some((r) => /LNTRN/.test(r.innerText) && /1,000,000/.test(r.innerText)), null, { timeout: 20000 });
});

await step("transfer: the buyer sends coins to the seller with the amount sealed", async () => {
  await walletAction(ben, "transfer", { coin: "LNTRN", amount: "250000", to: anaAddress, memo: "for the poster" });
  const panel = await ben.locator(".confirm .panel").innerText();
  if (!/THE COIN/i.test(panel) || !/THE AMOUNT/i.test(panel) || !/THE RECIPIENT'S WALLET/i.test(panel)) throw new Error("panel: " + panel.replace(/\n/g, " | "));
  await shot(ben, "07-transfer-review");
  await ben.click("text=Sign and transfer");
  await ben.waitForFunction(() => /SENT\./i.test(document.body.innerText), null, { timeout: 30000 });
  await ben.waitForFunction(() => /FOR THE POSTER/i.test(document.body.innerText), null, { timeout: 20000 });
  await shot(ben, "08-wallet-after");
});

await step("withdraw: the buyer takes some coins back out, in public", async () => {
  await walletAction(ben, "withdraw", { coin: "LNTRN", amount: "50000" });
  await ben.click("text=Sign and withdraw");
  await ben.waitForFunction(() => /WITHDRAWN\./i.test(document.body.innerText), null, { timeout: 60000 });
});

await step("OTC: the seller offers a block to the buyer, who accepts; both sides settle together", async () => {
  await ana.goto(`${base}/otc`);
  await ana.waitForSelector("#o-amount");
  await ana.fill("#o-amount", "500000"); await ana.fill("#o-price", "1.5"); await ana.fill("#o-buyer", benAddress);
  await ana.click("text=Review");
  await ana.waitForSelector(".confirm .panel");
  await shot(ana, "09-otc-review");
  await ana.click("text=Sign and offer");
  await ana.waitForFunction(() => /OFFER SENT/i.test(document.body.innerText), null, { timeout: 30000 });
  await ben.goto(`${base}/otc`);
  await ben.waitForSelector('.events button:has-text("Accept")', { timeout: 30000 });
  await shot(ben, "10-otc-offered");
  await ben.click('.events button:has-text("Accept")');
  await ben.click("text=Sign and buy");
  await ben.waitForFunction(() => /SETTLED\./i.test(document.body.innerText), null, { timeout: 30000 });
  await ben.goto(`${base}/wallet`);
  // 1,000,000 deposited - 250,000 sent - 50,000 withdrawn + 500,000 bought = 1,200,000 ; SOL 3 - 1.5 = 1.5
  await ben.waitForFunction(() => [...document.querySelectorAll("table.plain tr")].some((r) => /LNTRN/.test(r.innerText) && /1,200,000/.test(r.innerText)), null, { timeout: 20000 });
  if (!/^1\.5$/.test((await ringCell(ben, "SOL").innerText()).trim())) throw new Error("buyer Ring SOL is " + (await ringCell(ben, "SOL").innerText()));
});

await step("pay link: the seller asks for a payment by link and QR; the buyer pays from the Ring", async () => {
  await ana.goto(`${base}/pay`);
  await ana.waitForSelector("#p-amount");
  await ana.selectOption("#p-coin", { label: "LNTRN" });
  await ana.fill("#p-amount", "1234.5"); await ana.fill("#p-memo", "two prints");
  await ana.waitForSelector(".qr svg");
  const link = (await ana.locator("#pay-link").innerText()).trim();
  if (!link.includes(anaAddress)) throw new Error("the link lost the address case: " + link);
  await shot(ana, "11-pay-link");
  await ben.goto(link);
  await ben.waitForSelector(".confirm .panel");
  const text = await ben.locator(".confirm").innerText();
  if (!/1,234\.5/.test(text) || !/TWO PRINTS/i.test(text)) throw new Error(text.replace(/\n/g, " | "));
  await shot(ben, "12-pay-request");
  await ben.click("text=Sign and pay");
  await ben.waitForFunction(() => /PAID FROM YOUR RING BALANCE/i.test(document.body.innerText), null, { timeout: 30000 });
});

await step("creator fees: the seller claims them into the Ring", async () => {
  await ana.goto(`${base}/coin/${mint}`);
  await ana.waitForSelector("text=Creator fees");
  await ana.waitForFunction(() => /SOL TO CLAIM/i.test(document.body.innerText), null, { timeout: 20000 });
  await ana.locator(".form:has(h2) >> text=Review").click();
  await ana.waitForSelector(".confirm .panel");
  await shot(ana, "13-fees-review");
  await ana.click("text=Sign and claim");
  await ana.waitForFunction(() => /CLAIMED .* INTO YOUR RING BALANCE/i.test(document.body.innerText), null, { timeout: 60000 });
});

await step("the wallet locks and unlocks with the password; addresses keep their case", async () => {
  await ana.goto(`${base}/wallet`);
  await ana.waitForSelector(".kv .address");
  const shown = (await ana.locator(".kv .address").first().innerText()).trim();
  if (shown !== anaAddress) throw new Error(`address shown as ${shown}`);
  await shot(ana, "14-seller-wallet");
  await ana.click("text=Lock");
  await ana.waitForSelector("text=Unlock your wallet");
  await ana.fill("#wallet-password", "wrong password here");
  await ana.click("button:has-text('Unlock')");
  await ana.waitForFunction(() => /WRONG PASSWORD/i.test(document.body.innerText), null, { timeout: 30000 });
  await ana.fill("#wallet-password", "correct horse battery");
  await ana.click("button:has-text('Unlock')");
  await ana.waitForSelector(".kv .address", { timeout: 30000 });
});

await step("phone width: the wallet and explore pages fit without sideways scroll", async () => {
  await ben.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/wallet", "/explore", `/coin/${mint}`, "/otc", "/pay", "/launch"]) {
    await ben.goto(base + path); await ben.waitForTimeout(1200);
    const overflow = await ben.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) throw new Error(`${path} overflows by ${overflow}px`);
    await ben.screenshot({ path: `shots/app/phone-${path.split("/")[1]}.png` });
  }
});

await browser.close();
const failed = results.filter(([r]) => r === "FAIL").length;
console.log(`\n${results.length - failed} of ${results.length} steps passed. Browser errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log("  ", e.slice(0, 200));
process.exit(failed || errors.length ? 1 : 0);
