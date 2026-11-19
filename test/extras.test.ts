import { describe, expect, it } from "vitest";
import { Notifier, formatCycleMessage } from "../src/notify.js";
import { displayAmount, parseLedger, renderHtml, summarize, type Units } from "../src/report.js";

const units: Units = { quoteDecimals: 2, burnDecimals: 0, quoteSymbol: "TTWO", burnSymbol: "DCTY", strategyDecimals: 0, strategySymbol: "DSTRAT" };
const ledger = [
  { time: "2026-11-20T10:00:00.000Z", type: "claim", cycle: 1, signature: "s1", claimed: "1000", toBurn: "400", toBuyback: "200", toHolders: "400" },
  { time: "2026-11-20T10:00:05.000Z", type: "swap", cycle: 1, signature: "s2", spent: "400", bought: "4000" },
  { time: "2026-11-20T10:00:09.000Z", type: "burn", cycle: 1, signature: "s3", burned: "4000" },
  { time: "2026-11-20T10:00:10.000Z", type: "buyback", cycle: 1, signature: "s3b", spent: "200", bought: "20000" },
  { time: "2026-11-20T10:00:11.000Z", type: "buyback_burn", cycle: 1, signature: "s3c", burned: "20000" },
  { time: "2026-11-20T10:00:12.000Z", type: "distribution", cycle: 1, pool: "400" },
  { time: "2026-11-20T10:00:15.000Z", type: "payout", cycle: 1, signature: "s4", payouts: [{ owner: "alice", amount: "300" }, { owner: "bob", amount: "100" }] },
  { time: "2026-11-20T11:00:15.000Z", type: "payout", cycle: 2, signature: "s5", payouts: [{ owner: "alice", amount: "100" }] },
  { time: "2026-11-20T11:00:20.000Z", type: "tx_expired", cycle: 2, signature: "s6", kind: "swap" },
].map((row) => JSON.stringify(row)).join("\n");

describe("public stats", () => {
  const summary = summarize(parseLedger(`${ledger}\n\n`), units);
  it("adds up the ledger", () => {
    expect(summary).toMatchObject({ cycles: 2, claimed: 1000n, swapped: 400n, burned: 4000n, boughtBack: 200n, selfBurned: 20000n, paid: 500n, payoutTransfers: 3, recipients: 2 });
    expect(summary.topRecipients).toEqual([{ owner: "alice", amount: 400n }, { owner: "bob", amount: 100n }]);
    expect(summary.lastActivity).toBe("2026-11-20T11:00:15.000Z");
  });
  it("lists real transactions newest first and leaves out ones that never landed", () => {
    expect(summary.recent.map((e) => e.signature)).toEqual(["s5", "s4", "s3c", "s3b", "s3", "s2", "s1"]);
    expect(summary.recent[1]!.text).toBe("Paid 4 TTWO to 2 holders");
    expect(summary.recent[3]!.text).toBe("Bought back 20000 DSTRAT with 2 TTWO");
  });
  it("renders a page with totals and transaction links, escaping anything unsafe", () => {
    const html = renderHtml(summary, units, { title: "<script>x</script>", treasury: "TREASURY", generated: "2026-11-20T12:00:00.000Z" });
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toContain("<script>x");
    expect(html).toContain("https://solscan.io/tx/s5");
    expect(html).toContain(">4,000<");
    expect(html).toContain(">20,000<");
  });
  it("formats headline numbers with separators and without rounding up", () => {
    expect(displayAmount(170592592569252n, 6)).toBe("170,592,592.56");
    expect(displayAmount(999n, 2)).toBe("9.99");
    expect(displayAmount(1999999n, 6, 4)).toBe("1.9999");
    expect(displayAmount(5000n, 0)).toBe("5,000");
  });
  it("renders an empty ledger without failing", () => {
    const html = renderHtml(summarize([], units), units, { title: "t", treasury: "T", generated: "" });
    expect(html).toContain("Nothing yet.");
  });
});

describe("alerts", () => {
  const quiet = { cycle: 3, claimed: 0n, swapped: 0n, burned: 0n, boughtBack: 0n, selfBurned: 0n, paid: 0n, recipients: 0, skipped: [], notes: ["no fees to claim"] };
  const decimals = { quoteDecimals: 2, burnDecimals: 0, strategyDecimals: 0 };
  it("stays silent after a cycle that did nothing", () => {
    expect(formatCycleMessage(quiet, decimals)).toBeNull();
  });
  it("summarises a cycle that moved money", () => {
    const text = formatCycleMessage({ ...quiet, claimed: 1000n, swapped: 400n, burned: 4000n, boughtBack: 200n, selfBurned: 20000n, paid: 400n, recipients: 2 }, decimals);
    expect(text).toBe("Cycle 3\nClaimed 10 TTWO\nBurned 4000 DCTY (spent 4 TTWO)\nBought back and burned 20000 of the coin (spent 2 TTWO)\nPaid 4 TTWO to 2 holders");
  });
  it("links the dashboard when a site is configured, but not on a quiet or troubled-only cycle", () => {
    const busy = { ...quiet, claimed: 1000n };
    expect(formatCycleMessage(busy, decimals, "https://example.org/site/")).toContain("Dashboard: https://example.org/site/dashboard.html");
    expect(formatCycleMessage({ ...quiet, skipped: [{ owner: "bob", amount: "1", reason: "frozen" }] }, decimals, "https://example.org")).not.toContain("Dashboard");
  });
  it("mentions undelivered payouts", () => {
    const text = formatCycleMessage({ ...quiet, skipped: [{ owner: "bob", amount: "1", reason: "frozen" }] }, decimals);
    expect(text).toContain("1 payout(s) could not be delivered");
  });

  function recorder(fail = false) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) as Record<string, unknown> });
      if (fail) throw new Error("network down");
      return new Response("{}");
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }
  it("posts to Discord and Telegram when configured, and to nothing otherwise", async () => {
    const { calls, fetchImpl } = recorder();
    const off = new Notifier({ discordWebhookUrl: null, telegramBotToken: null, telegramChatId: null }, fetchImpl);
    expect(off.enabled).toBe(false);
    await off.send("hi");
    expect(calls).toHaveLength(0);
    const on = new Notifier({ discordWebhookUrl: "https://discord.example/hook", telegramBotToken: "T", telegramChatId: "42" }, fetchImpl);
    await on.send("hi");
    expect(calls.map((c) => c.url)).toEqual(["https://discord.example/hook", "https://api.telegram.org/botT/sendMessage"]);
    expect(calls[0]!.body).toEqual({ content: "hi" });
    expect(calls[1]!.body).toMatchObject({ chat_id: "42", text: "hi" });
  });
  it("never throws when an alert cannot be sent", async () => {
    const { fetchImpl } = recorder(true);
    const logged: string[] = [];
    const notifier = new Notifier({ discordWebhookUrl: "https://discord.example/hook", telegramBotToken: null, telegramChatId: null }, fetchImpl, (m) => logged.push(m));
    await expect(notifier.send("hi")).resolves.toBeUndefined();
    expect(logged[0]).toContain("network down");
  });
  it("does not repeat the same error every cycle", async () => {
    const { calls, fetchImpl } = recorder();
    const notifier = new Notifier({ discordWebhookUrl: "https://discord.example/hook", telegramBotToken: null, telegramChatId: null }, fetchImpl);
    await notifier.error("rpc down");
    await notifier.error("rpc down");
    await notifier.error("low sol");
    notifier.clearError();
    await notifier.error("low sol");
    expect(calls).toHaveLength(3);
  });
});
