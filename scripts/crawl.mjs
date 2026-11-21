// Visits every page at desktop and phone width, with and without a wallet, and:
// - records console errors, page errors, failed requests and unexpected error responses
// - checks for sideways overflow, clipped text and text too small to read
// - clicks every button, tab and checkbox and reports any that change nothing
// - checks that every internal link leads somewhere
// - submits every form empty and expects a message
// Needs the validator, at least one launched coin (npm run e2e leaves three) and a server
// on PORT (default 3311). Writes shots/crawl.json. Run: npm run crawl
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const base = `http://127.0.0.1:${process.env.PORT ?? 3311}`;
const post = async (op, input = {}) =>
  (await fetch(`${base}/api/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) })).json();

const [coin] = (await post("explore")).coins;
if (!coin) throw new Error("Launch a coin first (npm run e2e), so the coin and receipt pages have something to show.");
const PAGES = [
  "/",
  "/explore",
  "/launch",
  "/wallet",
  "/otc",
  "/pay",
  `/coin/${coin.mint}`,
  `/tx/${coin.signature}`,
  "/status",
  "/changelog",
  "/docs",
  "/terms",
  "/privacy",
];
/** Pages that are meant to answer with an error, and must do it with a designed page and a plain sentence. */
const BROKEN = ["/coin/not-an-address", `/coin/${coin.creator}`, "/tx/not-a-signature", "/no-such-page", "/pay?to=nobody&mint=x&amount=1"];
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };

const findings = [];
const note = (kind, where, detail) => findings.push({ kind, where, detail });
let clicked = 0;
let linksChecked = 0;
let formsSubmitted = 0;
const linkStatus = new Map();

/** Everything a person could notice changing after a click. */
const signature = (page) =>
  page.evaluate(() => {
    const live = [...document.querySelectorAll("[aria-pressed], [aria-expanded], input, select, textarea")]
      .map((el) => `${el.getAttribute("aria-pressed")}${el.getAttribute("aria-expanded")}${el.checked}${el.value}`)
      .join("|");
    return `${location.href}#${document.body.innerText}#${live}#${document.activeElement?.tagName}`;
  });

async function inspect(page, where) {
  const problems = await page.evaluate(() => {
    const out = [];
    const overflow = document.documentElement.scrollWidth - innerWidth;
    if (overflow > 0) out.push(["overflow", `the page is ${overflow}px wider than the window`]);
    const seen = new Set();
    for (const el of document.querySelectorAll("body *")) {
      if (!el.childNodes.length || ![...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (style.visibility === "hidden" || style.display === "none" || box.width === 0 || box.height === 0 || el.closest("[aria-hidden='true'], .sr, .skip"))
        continue;
      const text = el.textContent.trim().slice(0, 40);
      const size = parseFloat(style.fontSize);
      if (size < 11 && !seen.has(`s${text}`)) (seen.add(`s${text}`), out.push(["small-text", `${size}px: "${text}"`]));
      // Text cut off inside a box that hides what does not fit.
      if (style.overflow !== "visible" && el.scrollWidth > el.clientWidth + 1 && style.overflowX !== "auto" && style.overflowX !== "scroll")
        out.push(["clipped", `"${text}"`]);
      if (box.right > innerWidth + 1 && !el.closest(".scroll-x"))
        out.push(["off-screen", `"${text}" ends ${Math.round(box.right - innerWidth)}px past the right edge`]);
      const [r, g, b] = style.color.match(/[\d.]+/g).map(Number);
      const opacity = parseFloat(style.opacity);
      if ((0.2126 * r + 0.7152 * g + 0.0722 * b) * opacity < 110 && !seen.has(`c${text}`))
        (seen.add(`c${text}`), out.push(["dim-text", `${style.color} at opacity ${opacity}: "${text}"`]));
    }
    // Controls a finger cannot hit.
    if (innerWidth < 500)
      for (const el of document.querySelectorAll("a, button, input, select")) {
        const box = el.getBoundingClientRect();
        // A link inside a sentence is as tall as its line; everything else must be a comfortable target.
        const inSentence = el.tagName === "A" && [...el.parentElement.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim().length > 1);
        if (box.width > 0 && box.height > 0 && box.height < (inSentence ? 11 : 40) && !el.closest(".skip, label"))
          out.push([
            "small-target",
            `${Math.round(box.height)}px tall: "${(el.innerText || el.getAttribute("aria-label") || el.id || el.tagName).trim().slice(0, 30)}"`,
          ]);
      }
    for (const el of document.querySelectorAll("input:not([type=hidden]), select, textarea")) {
      if (!el.labels?.length && !el.getAttribute("aria-label") && !el.closest("label")) out.push(["no-label", el.id || el.name || el.type]);
    }
    for (const img of document.querySelectorAll("img")) {
      if (!img.hasAttribute("alt")) out.push(["no-alt", img.src]);
      if (img.complete && img.naturalWidth === 0 && img.loading !== "lazy") out.push(["broken-image", img.src]);
    }
    if (!document.title.trim()) out.push(["no-title", ""]);
    const headings = [...document.querySelectorAll("h1")].filter((el) => el.getClientRects().length > 0).length;
    if (headings !== 1) out.push(["h1-count", String(headings)]);
    return out;
  });
  for (const [kind, detail] of problems) note(kind, where, detail);
}

async function checkLinks(page, where) {
  const links = await page.evaluate(() =>
    [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: a.innerText.trim() || a.getAttribute("aria-label") || "" })),
  );
  for (const { href, text } of links) {
    if (!text) note("link-without-text", where, href);
    if (!href.startsWith(base)) {
      if (!/^(https:|mailto:)/.test(href)) note("odd-link", where, href);
      continue;
    }
    const url = href.split("#")[0];
    if (!linkStatus.has(url)) (linkStatus.set(url, (await fetch(url)).status), linksChecked++);
    if (linkStatus.get(url) !== 200) note("dead-link", where, `${text} -> ${url} answered ${linkStatus.get(url)}`);
    const hash = href.split("#")[1];
    if (hash && url === page.url().split("#")[0] && !(await page.evaluate((id) => !!document.getElementById(id), hash))) note("dead-anchor", where, href);
  }
}

async function clickEverything(page, path, where) {
  const count = await page.locator("button, [role=tab], input[type=checkbox], summary").count();
  for (let index = 0; index < count; index++) {
    const control = page.locator("button, [role=tab], input[type=checkbox], summary").nth(index);
    if (!(await control.isVisible().catch(() => false))) continue;
    const label = ((await control.innerText().catch(() => "")) || (await control.getAttribute("aria-label")) || (await control.getAttribute("type")) || "")
      .trim()
      .slice(0, 40);
    if (await control.isDisabled()) {
      // A disabled control must say why somewhere near it: a form with nothing typed, or a line of text.
      continue;
    }
    const before = await signature(page);
    let sideEffect = false;
    const onRequest = () => (sideEffect = true);
    const onDownload = () => (sideEffect = true);
    page.on("request", onRequest);
    page.on("download", onDownload);
    const copied = await page.evaluate(() => {
      window.__copied = false;
      const original = navigator.clipboard?.writeText?.bind(navigator.clipboard);
      if (navigator.clipboard)
        navigator.clipboard.writeText = (text) => ((window.__copied = true), original ? original(text).catch(() => undefined) : Promise.resolve());
      return true;
    });
    await control.click({ timeout: 5000 }).catch((error) => note("unclickable", where, `"${label}": ${String(error.message).split("\n")[0]}`));
    clicked++;
    await page.waitForTimeout(350);
    const after = await signature(page).catch(() => "navigated");
    const didCopy = copied && (await page.evaluate(() => window.__copied).catch(() => false));
    page.off("request", onRequest);
    page.off("download", onDownload);
    if (after === before && !sideEffect && !didCopy) note("does-nothing", where, `"${label}"`);
    // Put the page back as it was for the next control.
    if (after !== before) {
      await page.goto(base + path, { waitUntil: "load" });
      await page.waitForTimeout(500);
    }
  }
}

async function submitEmptyForms(page, path, where) {
  const count = await page.locator("form").count();
  for (let index = 0; index < count; index++) {
    const form = page.locator("form").nth(index);
    const submit = form.locator("button[type=submit]");
    if (!(await submit.count()) || !(await submit.first().isVisible())) continue;
    if (await submit.first().isDisabled()) continue; // nothing typed yet: the button waits
    await submit.first().click();
    formsSubmitted++;
    await page.waitForTimeout(400);
    const message = await page.evaluate(() =>
      [...document.querySelectorAll("[role=alert], .status-line.bad")]
        .map((el) => el.innerText.trim())
        .filter(Boolean)
        .join(" / "),
    );
    if (!message) note("silent-form", where, `form ${index + 1} submitted empty and said nothing`);
    await page.goto(base + path, { waitUntil: "load" });
    await page.waitForTimeout(400);
  }
}

const browser = await chromium.launch();
mkdirSync("shots/crawl", { recursive: true });
for (const [device, viewport] of Object.entries(SIZES)) {
  for (const wallet of [false, true]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    let where = "";
    let expectErrors = false;
    page.on("pageerror", (error) => note("page-error", where, String(error)));
    page.on(
      "console",
      (message) => message.type() === "error" && !(expectErrors && /status of 4\d\d/.test(message.text())) && note("console-error", where, message.text()),
    );
    page.on("requestfailed", (request) => !/_rsc=/.test(request.url()) && note("request-failed", where, `${request.url()} ${request.failure()?.errorText}`));
    page.on(
      "response",
      (response) => response.status() >= 400 && !expectErrors && note("error-response", where, `${response.status()} ${response.url().replace(base, "")}`),
    );
    if (wallet) {
      await page.goto(`${base}/wallet`);
      await page.fill("#wallet-password", "correct horse battery");
      await page.fill("#wallet-password-again", "correct horse battery");
      await page.click("text=Create wallet");
      await page.waitForSelector(".kv .address", { timeout: 30000 });
    }
    for (const path of PAGES) {
      where = `${path.replace(coin.mint, "<coin>").replace(coin.signature, "<signature>")} ${device}${wallet ? " wallet" : ""}`;
      await page.goto(base + path, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      await inspect(page, where);
      if (!wallet) await checkLinks(page, where);
      await page.screenshot({
        path: `shots/crawl/${device}${wallet ? "-wallet" : ""}${path === "/" ? "-home" : path.replace(/\//g, "-").replace(coin.mint, "coin").replace(coin.signature, "sig")}.png`,
        fullPage: true,
      });
      // An empty form says what is missing; then every control is tried.
      expectErrors = true;
      await submitEmptyForms(page, path, where);
      expectErrors = false;
      await clickEverything(page, path, where);
    }
    if (!wallet) {
      expectErrors = true;
      for (const path of BROKEN) {
        where = `${path.replace(coin.creator, "<not-a-coin>")} ${device}`;
        await page.goto(base + path, { waitUntil: "load" });
        await page.waitForTimeout(1200);
        await inspect(page, where);
        const text = await page
          .locator("main")
          .innerText()
          .catch(() => "");
        if (!/not valid|not found|no such|could not|does not exist|cannot be|no coin|not a/i.test(text))
          note("unclear-error-page", where, text.replace(/\s+/g, " ").slice(0, 160));
        if (!(await page.locator("header a").count())) note("error-page-without-navigation", where, "");
        await page.screenshot({ path: `shots/crawl/${device}-broken${path.split("?")[0].replace(/\//g, "-").replace(coin.creator, "wallet")}.png` });
      }
      expectErrors = false;
    }
    await context.close();
  }
}
await browser.close();

const byKind = {};
for (const finding of findings) (byKind[finding.kind] ??= []).push(finding);
writeFileSync("shots/crawl.json", `${JSON.stringify({ pages: PAGES.length + BROKEN.length, clicked, linksChecked, formsSubmitted, findings }, null, 2)}\n`);
console.log(`${PAGES.length} pages + ${BROKEN.length} error pages, 2 widths, with and without a wallet.`);
console.log(`${clicked} controls clicked, ${linksChecked} distinct links checked, ${formsSubmitted} empty forms submitted. ${findings.length} findings.`);
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`\n${kind} (${list.length})`);
  const unique = new Map();
  for (const finding of list) unique.set(finding.detail, [...(unique.get(finding.detail) ?? []), finding.where]);
  for (const [detail, wheres] of [...unique].slice(0, 25))
    console.log(`  ${detail}   [${wheres.length > 3 ? `${wheres.slice(0, 3).join("; ")} +${wheres.length - 3}` : wheres.join("; ")}]`);
}
process.exit(findings.length ? 1 : 0);
