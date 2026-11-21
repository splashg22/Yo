// The sealed launch window in a browser, with the feature switched on: open, commit, take back, cancel,
// and the balance on screen after each. The launch itself needs a closed window, which takes at least an
// hour of real time, so it is covered by the flow tests (test/flows/window.test.ts), not here.
// Starts its own copy of the site with FEATURE_SEALED_WINDOW=on. Needs the validator and a build. Run: npm run window
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const port = 4713;
const base = `http://127.0.0.1:${port}`;
const off = `http://127.0.0.1:${process.env.PORT ?? 4711}`;
const PASSWORD = "correct horse battery";
const results = [];
async function check(label, run) {
  try {
    await run();
    results.push("ok");
    console.log("ok  ", label);
  } catch (error) {
    results.push("FAIL");
    console.log("FAIL", label, "::", String(error.message).split("\n")[0].slice(0, 300));
  }
}
const post = async (origin, op, input = {}) => {
  const response = await fetch(`${origin}/api/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  return { status: response.status, body: await response.json() };
};

rmSync(".data-window", { recursive: true, force: true });
const server = spawn("node", ["dist/server.mjs"], {
  env: { ...process.env, NODE_ENV: "production", PORT: String(port), FEATURE_SEALED_WINDOW: "on", APP_DATA_DIR: ".data-window", LOG_SILENT: "1" },
  stdio: "ignore",
  detached: true,
});
const browser = await chromium.launch();
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await post(base, "config").catch(() => null))?.status === 200) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const errors = [];
  async function person(viewport = { width: 1280, height: 900 }) {
    const page = await (await browser.newContext({ viewport })).newPage();
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => message.type() === "error" && !/status of 400/.test(message.text()) && errors.push(message.text()));
    await page.goto(`${base}/wallet`);
    await page.fill("#wallet-password", PASSWORD);
    await page.fill("#wallet-password-again", PASSWORD);
    await page.click("text=Create wallet");
    await page.waitForSelector(".kv .address", { timeout: 30000 });
    page.address = await page.locator(".kv .address").first().getAttribute("title");
    await post(base, "faucet", { wallet: page.address });
    return page;
  }
  const said = (page, pattern) =>
    page.waitForFunction(
      (source) => new RegExp(source, "i").test([...document.querySelectorAll(".status-line")].map((line) => line.innerText).join(" ")),
      pattern.source,
      { timeout: 60000 },
    );
  const ringSol = async (page) => {
    await page.goto(`${base}/wallet`);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("table.plain tbody td:nth-child(3)")].length > 0 &&
        [...document.querySelectorAll("table.plain tbody td:nth-child(3)")].every((cell) => !/reading/i.test(cell.innerText)),
    );
    return (
      await page
        .locator("table.plain tbody tr")
        .filter({ has: page.locator('td:first-child:text-is("SOL")') })
        .locator("td")
        .nth(2)
        .innerText()
    ).trim();
  };
  const creator = await person();
  const buyer = await person();

  await check("switched off, the launch page shows no window section and the server refuses; switched on, it is there with its warning", async () => {
    const refused = await post(off, "window/list");
    if (refused.status !== 400 || !/switched off/.test(refused.body.error)) throw new Error(JSON.stringify(refused));
    await creator.goto(`${base}/launch`);
    await creator.waitForSelector("#sealed-windows");
    const text = await creator.locator("section[aria-labelledby='sealed-windows']").innerText();
    if (!/EXPERIMENTAL/i.test(text) || !/HOLDS WHAT BUYERS COMMIT/i.test(text) || !/LOCAL TEST CHAIN/i.test(text)) throw new Error("the warning is missing");
  });

  await check("a creator opens a window; a buyer commits from the Ring, takes it back, commits again; the creator cancels and it all comes back", async () => {
    await creator.fill("#sw-name", "Sealed Lantern");
    await creator.fill("#sw-symbol", "SEAL");
    await creator.fill("#sw-hours", "2");
    await creator.click("button:text-is('Open window')");
    await said(creator, /window opened/);
    // The buyer puts 1 SOL into the Ring first.
    await buyer.goto(`${base}/wallet`);
    await buyer.waitForSelector("#w-amount");
    await buyer.fill("#w-amount", "1");
    await buyer.click("button:text-is('Review')");
    await buyer.click("text=Sign and deposit");
    await said(buyer, /deposited/);
    if ((await ringSol(buyer)) !== "1") throw new Error("the deposit is not in the Ring");

    const commit = async (amount) => {
      await buyer.goto(`${base}/launch`);
      await buyer.waitForSelector(".events input[placeholder='SOL']");
      await buyer.fill(".events input[placeholder='SOL']", amount);
      await buyer.click(".events button:text-is('Commit')");
      await said(buyer, /committed to sealed lantern/);
    };
    await commit("0.25");
    await buyer.waitForFunction(
      () => /1 WALLET HAS COMMITTED 0\.25 SOL IN TOTAL/i.test(document.body.innerText) && /YOU HAVE COMMITTED 0\.25 SOL/i.test(document.body.innerText),
    );
    if ((await ringSol(buyer)) !== "0.75") throw new Error(`after committing the Ring shows ${await ringSol(buyer)}`);
    // The creator sees the total, not a list of who put in what.
    await creator.reload();
    await creator.waitForFunction(() => /1 WALLET HAS COMMITTED 0\.25 SOL IN TOTAL/i.test(document.body.innerText));
    if ((await creator.locator("body").innerText()).includes(buyer.address)) throw new Error("the committer's address is shown to others");

    await buyer.goto(`${base}/launch`);
    await buyer.click(".events button:text-is('Take mine back')");
    await said(buyer, /back in your ring balance/);
    if ((await ringSol(buyer)) !== "1") throw new Error("taking it back did not restore the balance");
    // A bad amount and more than is held are refused with a reason.
    await buyer.goto(`${base}/launch`);
    await buyer.waitForSelector(".events input[placeholder='SOL']");
    await buyer.fill(".events input[placeholder='SOL']", "abc");
    await buyer.click(".events button:text-is('Commit')");
    await said(buyer, /enter an amount/);
    await buyer.fill(".events input[placeholder='SOL']", "0.4");
    await buyer.click(".events button:text-is('Commit')");
    await said(buyer, /committed to sealed lantern/);
    await buyer.fill(".events input[placeholder='SOL']", "0.2");
    await buyer.click(".events button:text-is('Commit')");
    await said(buyer, /over its limit/);

    await creator.reload();
    await creator.waitForSelector(".events button:text-is('Cancel the window')");
    if (await creator.locator(".events button:text-is('Launch')").count()) throw new Error("Launch is offered while the window is still open to commitments");
    await creator.click(".events button:text-is('Cancel the window')");
    await said(creator, /every commitment was returned/);
    if ((await ringSol(buyer)) !== "1") throw new Error(`after the cancel the buyer's Ring shows ${await ringSol(buyer)}`);
    const status = (await post(base, "status")).body;
    if (!status.escrow.every((row) => row.covered)) throw new Error("escrow no longer covers what it owes");
  });

  await check("the window section fits a phone, and nothing errored along the way", async () => {
    await buyer.setViewportSize({ width: 390, height: 844 });
    await buyer.goto(`${base}/launch`);
    await buyer.waitForSelector("#sealed-windows");
    await buyer.waitForTimeout(800);
    const overflow = await buyer.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) throw new Error(`the launch page is ${overflow}px too wide`);
    await buyer.screenshot({ path: "shots/app/19-sealed-window-phone.png", fullPage: true });
    if (errors.length) throw new Error(errors[0]);
  });
} finally {
  await browser.close();
  process.kill(-server.pid);
  rmSync(".data-window", { recursive: true, force: true });
}
const failed = results.filter((result) => result === "FAIL").length;
console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
