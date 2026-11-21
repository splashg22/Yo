// Checks the homepage scroll sequence and the site-wide background under hard conditions:
// a slow phone, reduced motion, a hidden tab, very tall, very narrow and very short windows,
// and fast scrolling. Looks for jumps, blank frames and dropped text.
// Needs a server on PORT (default 3311). Run: npm run motion
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const { chromium } = createRequire(import.meta.url)("playwright");
const base = `http://127.0.0.1:${process.env.PORT ?? 3311}`;
const media = JSON.parse(readFileSync("lib/media.json", "utf8"));
const END_OF_MOTION = 0.74; // as in components/Sequence.tsx

const results = [];
async function check(label, run) {
  try {
    const detail = await run();
    results.push(["ok", label]);
    console.log("ok  ", label, detail ? `:: ${detail}` : "");
  } catch (error) {
    results.push(["FAIL", label]);
    console.log("FAIL", label, "::", String(error.message).split("\n")[0].slice(0, 400));
  }
}
const browser = await chromium.launch();
/** Counts canvas draws, so "is it still animating" has an answer. */
const COUNT_DRAWS = () => {
  window.__draws = 0;
  for (const name of ["stroke", "fill", "drawImage", "fillRect"]) {
    const original = CanvasRenderingContext2D.prototype[name];
    CanvasRenderingContext2D.prototype[name] = function (...args) {
      window.__draws += 1;
      return original.apply(this, args);
    };
  }
  window.__shift = 0;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shift += entry.value;
  }).observe({ type: "layout-shift", buffered: true });
};
async function open(viewport, options = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: options.scale ?? 1,
    reducedMotion: options.reduced ? "reduce" : "no-preference",
    isMobile: options.mobile,
    hasTouch: options.mobile,
  });
  await context.addInitScript(COUNT_DRAWS);
  const page = await context.newPage();
  page.problems = [];
  page.on("pageerror", (error) => page.problems.push(String(error)));
  page.on("console", (message) => message.type() === "error" && page.problems.push(message.text()));
  if (options.slow) {
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await session.send("Network.enable");
    await session.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
  }
  return page;
}
/** What a person would see of the sequence right now. */
const look = (page) =>
  page.evaluate(() => {
    const seq = document.querySelector(".seq");
    const stage = seq.querySelector(".stage");
    const canvas = seq.querySelector("canvas");
    const still = seq.querySelector(".frame img");
    const words = seq.querySelector(".words .glitch > div");
    const rect = seq.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, -rect.top / (rect.height - innerHeight)));
    const visible = (el) =>
      el && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none" && parseFloat(getComputedStyle(el).opacity) > 0.05;
    let painted = false;
    if (canvas.dataset.ready && visible(canvas)) {
      // Is there anything but transparency in the middle band of the frame?
      const context = canvas.getContext("2d");
      const data = context.getImageData(0, Math.floor(canvas.height * 0.3), canvas.width, Math.floor(canvas.height * 0.4)).data;
      for (let index = 3; index < data.length; index += 64) if (data[index] > 20) ((painted = true), (index = data.length));
    }
    const wordsBox = words.getBoundingClientRect();
    return {
      progress,
      pinned: Math.round(stage.getBoundingClientRect().top),
      inSequence: rect.top <= 0 && rect.bottom >= innerHeight,
      frame: canvas.dataset.frame === undefined ? null : Number(canvas.dataset.frame),
      picture: painted || (still.complete && still.naturalWidth > 0 && visible(still)),
      words: words.innerText.trim().length,
      wordsVisible: visible(words) && visible(words.closest(".words")),
      wordsOnScreen: wordsBox.left >= -1 && wordsBox.right <= innerWidth + 1 && wordsBox.top >= -1 && wordsBox.bottom <= innerHeight + 1,
      height: document.documentElement.scrollHeight,
      overflow: document.documentElement.scrollWidth - innerWidth,
      scroll: scrollY,
    };
  });
const expectedFrame = (progress) => Math.round(Math.min(1, progress / END_OF_MOTION) * (media.frames - 1));
const allFramesLoaded = (page) =>
  page.waitForFunction((count) => performance.getEntriesByType("resource").filter((entry) => /\/media\/seq\//.test(entry.name)).length >= count, media.frames, {
    timeout: 120000,
  });

/** Scrolls the whole sequence in `steps` and reports every moment something was wrong. */
async function walk(page, steps, settle) {
  const wrong = [];
  const first = await look(page);
  const travel = await page.evaluate(() => document.querySelector(".seq").offsetHeight - innerHeight);
  for (let index = 0; index <= steps; index++) {
    await page.evaluate((y) => scrollTo(0, y), Math.round((travel * index) / steps));
    await page.waitForTimeout(settle);
    const now = await look(page);
    const at = `${Math.round(now.progress * 100)}%`;
    if (now.pinned !== 0) wrong.push(`${at}: the stage is ${now.pinned}px off the top`);
    if (!now.picture) wrong.push(`${at}: no picture`);
    if (!now.words || !now.wordsVisible) wrong.push(`${at}: no words`);
    if (!now.wordsOnScreen) wrong.push(`${at}: words run off the screen`);
    if (now.height !== first.height) wrong.push(`${at}: the page changed height by ${now.height - first.height}px`);
    if (now.overflow > 0) wrong.push(`${at}: sideways overflow ${now.overflow}px`);
    if (now.frame !== null && Math.abs(now.frame - expectedFrame(now.progress)) > 0 && settle >= 300)
      wrong.push(`${at}: frame ${now.frame}, expected ${expectedFrame(now.progress)}`);
  }
  return wrong;
}

await check(
  "slow phone (6x slower processor, slow network): the hero is readable at once, nothing shifts, and every step of the scroll has a picture and words",
  async () => {
    const page = await open({ width: 390, height: 844 }, { slow: true, mobile: true, scale: 2 });
    const started = Date.now();
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".seq h1", { state: "visible" });
    const headline = Date.now() - started;
    const early = await look(page);
    if (!early.words) throw new Error("no headline at first paint");
    await page.waitForFunction(() => document.querySelector(".seq .frame img").complete);
    const picture = Date.now() - started;
    // Scroll straight away, before the frames have arrived: the still or the nearest frame must cover.
    const wrongEarly = await walk(page, 12, 120);
    await allFramesLoaded(page);
    const wrongLate = await walk(page, 24, 450);
    const shift = await page.evaluate(() => window.__shift);
    const wrong = [...wrongEarly.map((text) => `early ${text}`), ...wrongLate];
    if (shift > 0.02) wrong.push(`layout shift ${shift.toFixed(3)}`);
    if (page.problems.length) wrong.push(page.problems[0]);
    if (wrong.length) throw new Error(`${wrong.length} problems: ${wrong.slice(0, 4).join("; ")}`);
    await page.context().close();
    return `headline at ${headline} ms, picture at ${picture} ms, layout shift ${shift.toFixed(3)}`;
  },
);

await check("fast scrolling: 200 jumps a frame apart never leave a blank stage or empty words, and the frame lands on the scroll position", async () => {
  const page = await open({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: "load" });
  await allFramesLoaded(page);
  await page.waitForTimeout(500);
  const report = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const seq = document.querySelector(".seq");
        const travel = seq.offsetHeight - innerHeight;
        const words = () => seq.querySelector(".words .glitch > div");
        let jumps = 0;
        let blank = 0;
        let unpinned = 0;
        let seed = 7;
        const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const tick = () => {
          if (!words().innerText.trim()) blank += 1;
          const top = Math.round(seq.querySelector(".stage").getBoundingClientRect().top);
          const rect = seq.getBoundingClientRect();
          if (rect.top <= 0 && rect.bottom >= innerHeight && top !== 0) unpinned += 1;
          if (jumps++ >= 200) return resolve({ blank, unpinned });
          // Mostly wild jumps, sometimes a flick of a few hundred pixels, as a thumb does.
          scrollTo(0, jumps % 3 ? random() * travel : Math.min(travel, scrollY + 400));
          requestAnimationFrame(tick);
        };
        tick();
      }),
  );
  if (report.blank || report.unpinned) throw new Error(`${report.blank} frames with no words, ${report.unpinned} frames with the stage off the top`);
  const landings = [];
  for (const share of [0.9, 0.05, 0.5, 0.33, 0.7, 0]) {
    await page.evaluate((s) => scrollTo(0, (document.querySelector(".seq").offsetHeight - innerHeight) * s), share);
    await page.waitForTimeout(350);
    const now = await look(page);
    if (now.frame !== expectedFrame(now.progress))
      throw new Error(`at ${Math.round(share * 100)}% the frame is ${now.frame}, expected ${expectedFrame(now.progress)}`);
    if (!now.picture || !now.words) throw new Error(`at ${Math.round(share * 100)}% picture=${now.picture} words=${now.words}`);
    landings.push(now.frame);
  }
  if (page.problems.length) throw new Error(page.problems[0]);
  await page.context().close();
  return `frames landed on ${landings.join(", ")}`;
});

await check("reduced motion: no pinned scroll, stills instead, one heading, and a background that does not move", async () => {
  const page = await open({ width: 1440, height: 900 }, { reduced: true });
  await page.goto(base, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => ({
    sequence: getComputedStyle(document.querySelector(".seq")).display,
    still: getComputedStyle(document.querySelector(".still")).display,
    headings: [...document.querySelectorAll("h1")].filter((el) => el.getClientRects().length).length,
    frames: performance.getEntriesByType("resource").filter((entry) => /\/media\/seq\//.test(entry.name)).length,
    animations: document.getAnimations().filter((animation) => animation.playState === "running").length,
  }));
  if (state.sequence !== "none" || state.still === "none") throw new Error(`sequence ${state.sequence}, stills ${state.still}`);
  if (state.headings !== 1) throw new Error(`${state.headings} headings visible`);
  if (state.frames) throw new Error(`${state.frames} sequence frames were downloaded for nothing`);
  if (state.animations) throw new Error(`${state.animations} animations running`);
  const before = await page.evaluate(() => window.__draws);
  await page.waitForTimeout(1200);
  const drawn = (await page.evaluate(() => window.__draws)) - before;
  if (drawn !== 0) throw new Error(`the background drew ${drawn} times while nothing was happening`);
  await page.evaluate(() => document.querySelector(".still-how").scrollIntoView());
  await page.waitForTimeout(600);
  const callouts = await page.evaluate(
    () => [...document.querySelectorAll(".still .callout .box, .still .callout-list li")].filter((el) => el.getClientRects().length).length,
  );
  if (callouts < 5) throw new Error(`${callouts} of 5 callouts are shown`);
  if (page.problems.length) throw new Error(page.problems[0]);
  await page.context().close();
  return "stills shown, 0 frames downloaded, 0 background draws at rest";
});

await check("hidden tab: the background stops drawing, and starts again when the tab comes back", async () => {
  const page = await open({ width: 1440, height: 900 });
  await page.goto(`${base}/docs`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const rate = async () => {
    const before = await page.evaluate(() => window.__draws);
    await page.waitForTimeout(1000);
    return (await page.evaluate(() => window.__draws)) - before;
  };
  const running = await rate();
  if (running === 0) throw new Error("the background was not animating to begin with");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hidden = await rate();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const back = await rate();
  if (hidden !== 0) throw new Error(`${hidden} draws in a second while hidden`);
  if (back === 0) throw new Error("it did not start again");
  await page.context().close();
  return `${running} draws a second visible, ${hidden} hidden, ${back} after coming back`;
});

for (const [name, viewport] of [
  ["very tall (390 x 3000)", { width: 390, height: 3000 }],
  ["very tall desktop (1440 x 2400)", { width: 1440, height: 2400 }],
  ["very narrow (280 x 600)", { width: 280, height: 600 }],
  ["very short and wide (2560 x 480)", { width: 2560, height: 480 }],
  ["small laptop (1024 x 600)", { width: 1024, height: 600 }],
  ["tablet (768 x 1024)", { width: 768, height: 1024 }],
]) {
  await check(`${name}: the whole sequence keeps its picture and words on screen, pinned, with no sideways scroll`, async () => {
    const page = await open(viewport);
    await page.goto(base, { waitUntil: "load" });
    await allFramesLoaded(page);
    const wrong = await walk(page, 16, 400);
    // The callouts at the end: all five readable, none cut off by the window.
    const callouts = await page.evaluate(() => {
      const shown = [...document.querySelectorAll(".seq .callout .box, .seq .callout-list li")].filter(
        (el) => el.getClientRects().length && parseFloat(getComputedStyle(el.closest(".callouts, .callout-list")).opacity) > 0.5,
      );
      return {
        count: shown.length,
        cut: shown.filter(
          (el) =>
            el.getBoundingClientRect().right > innerWidth + 1 ||
            el.getBoundingClientRect().left < -1 ||
            el.getBoundingClientRect().bottom > innerHeight + 1 ||
            el.getBoundingClientRect().top < -1,
        ).length,
      };
    });
    // On a phone the five follow the sequence in the page; there they only need to exist and fit the width.
    const below = await page.evaluate(
      () =>
        [...document.querySelectorAll(".how-list li")].filter((el) => el.getClientRects().length && el.getBoundingClientRect().right <= innerWidth + 1).length,
    );
    if (callouts.count < 5 && below < 5) wrong.push(`${callouts.count} of 5 callouts in the sequence and ${below} after it`);
    if (callouts.cut) wrong.push(`${callouts.cut} callouts are cut off by the window`);
    // Everything else on the homepage, to the footer.
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) wrong.push(`the page is ${overflow}px too wide`);
    if (page.problems.length) wrong.push(page.problems[0]);
    await page.screenshot({ path: `shots/motion-${name.split(" (")[0].replace(/ /g, "-")}.png` });
    await page.context().close();
    if (wrong.length) throw new Error(`${wrong.length} problems: ${[...new Set(wrong)].slice(0, 4).join("; ")}`);
  });
}

await check("resizing and turning the phone mid-sequence keeps the picture, the words and the pin", async () => {
  const page = await open({ width: 390, height: 844 });
  await page.goto(base, { waitUntil: "load" });
  await allFramesLoaded(page);
  await page.evaluate(() => scrollTo(0, (document.querySelector(".seq").offsetHeight - innerHeight) * 0.5));
  await page.waitForTimeout(400);
  const wrong = [];
  for (const viewport of [
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(500);
    const now = await look(page);
    if (now.inSequence && now.pinned !== 0) wrong.push(`${viewport.width}x${viewport.height}: stage ${now.pinned}px off the top`);
    if (!now.picture || !now.words) wrong.push(`${viewport.width}x${viewport.height}: picture=${now.picture} words=${now.words}`);
    if (now.overflow > 0) wrong.push(`${viewport.width}x${viewport.height}: overflow ${now.overflow}px`);
    if (now.inSequence && now.frame !== expectedFrame(now.progress))
      wrong.push(`${viewport.width}x${viewport.height}: frame ${now.frame}, expected ${expectedFrame(now.progress)}`);
  }
  await page.context().close();
  if (wrong.length) throw new Error(wrong.join("; "));
});

await browser.close();
const failed = results.filter(([result]) => result === "FAIL").length;
console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
