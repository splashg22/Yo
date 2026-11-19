import { describe, expect, it } from "vitest";
import {
  BooksMismatchError,
  LowSolError,
  PendingUnresolvedError,
  runDryCycle,
  runLiveCycle,
  type Deps,
  type Limits,
} from "../src/cycle.js";
import { DEFAULT_SPLIT } from "../src/split.js";
import { bookedQuote } from "../src/state.js";
import { CrashError, FakeChain, MemoryLedger, MemoryStore, MINTS } from "./fakes.js";

const LIMITS: Limits = {
  dryRun: false, split: DEFAULT_SPLIT, minHold: 1000n, minSol: 0n, maxSwapPerCycle: 1_000_000n, minClaim: 0n, minSwap: 0n,
  minDistribute: 0n, minPayout: 0n, payoutsPerTx: 2,
};

function world(limits: Partial<Limits> = {}) {
  const chain = new FakeChain();
  chain.holders = new Map([["alice", 3000n], ["bob", 1000n], ["carol", 999n], ["curve", 500_000n]]);
  chain.excluded = new Set(["curve"]);
  const store = new MemoryStore();
  const ledger = new MemoryLedger();
  const deps: Deps = {
    chain, store, ledger, limits: { ...LIMITS, ...limits },
    sleep: async () => {}, confirmTimeoutMs: 0,
  };
  return { chain, store, ledger, deps };
}

describe("a live cycle", () => {
  it("claims, splits 40/20/40, buys and burns DCTY, buys back and burns the coin, pays holders the rest", async () => {
    const { chain, store, ledger, deps } = world();
    chain.vault = 1000n;
    const report = await runLiveCycle(deps);

    expect(report.claimed).toBe(1000n);
    expect(report.swapped).toBe(400n);
    expect(chain.burned).toBe(4000n); // 400 TTWO at 10 per unit
    expect(report.burned).toBe(4000n);
    expect(report.boughtBack).toBe(200n);
    expect(chain.selfBurned).toBe(20_000n); // 200 TTWO at 100 per unit
    expect(report.selfBurned).toBe(20_000n);
    expect(chain.received.get("alice")).toBe(300n); // 3000 / 4000 of 400
    expect(chain.received.get("bob")).toBe(100n);
    expect(chain.received.has("carol")).toBe(false); // below the minimum
    expect(chain.received.has("curve")).toBe(false); // excluded
    expect(chain.quote).toBe(0n);
    expect(chain.coin).toBe(0n);
    expect(chain.self).toBe(0n);
    expect(bookedQuote(store.saved!)).toBe(0n);
    expect(store.saved!.pending).toBeNull();
    expect(ledger.entries.map((e) => e.type)).toEqual(["claim", "swap", "burn", "buyback", "buyback_burn", "distribution", "payout"]);
    expect(ledger.of("claim")[0]).toMatchObject({ claimed: "1000", toBurn: "400", toBuyback: "200", toHolders: "400" });
    expect(report.signatures.every((s) => s.outcome === "confirmed")).toBe(true);
  });

  it("follows whatever split it is given", async () => {
    const { chain, store, deps } = world({ split: { burn: 50, buyback: 0, holders: 50 } });
    chain.vault = 1000n;
    const report = await runLiveCycle(deps);
    expect(report.swapped).toBe(500n);
    expect(report.boughtBack).toBe(0n);
    expect(report.paid).toBe(500n);
    expect(store.saved!.buybackPool).toBe("0");
    expect(chain.sent.some((s) => s.includes("buyback"))).toBe(false);
  });

  it("caps each swap and carries the rest to later cycles", async () => {
    const { chain, store, deps } = world({ maxSwapPerCycle: 150n });
    chain.vault = 1000n;
    await runLiveCycle(deps);
    expect(store.saved!.burnPool).toBe("250");
    expect(store.saved!.buybackPool).toBe("50");
    expect(chain.quote).toBe(300n);
    await runLiveCycle(deps);
    expect(store.saved!.burnPool).toBe("100");
    expect(store.saved!.buybackPool).toBe("0");
    expect(chain.burned).toBe(3000n);
    expect(chain.selfBurned).toBe(20_000n);
  });

  it("never burns coins the treasury already owned", async () => {
    const { chain, deps } = world();
    chain.coin = 777_777n; // e.g. the owner's own bag of DCTY
    chain.self = 555_555n; // and of the strategy coin
    chain.vault = 1000n;
    await runLiveCycle(deps);
    expect(chain.burned).toBe(4000n);
    expect(chain.coin).toBe(777_777n);
    expect(chain.selfBurned).toBe(20_000n);
    expect(chain.self).toBe(555_555n);
  });

  it("never spends TTWO that is in the wallet but not in the books", async () => {
    const { chain, deps } = world();
    chain.quote = 9999n; // sent in from outside
    chain.vault = 1000n;
    await runLiveCycle(deps);
    expect(chain.quote).toBe(9999n);
  });

  it("does nothing when there are no fees", async () => {
    const { chain, deps } = world();
    const report = await runLiveCycle(deps);
    expect(chain.sent).toEqual([]);
    expect(report.notes).toContain("no fees to claim");
  });

  it("keeps the holder share in the books when nobody qualifies yet", async () => {
    const { chain, store, deps } = world({ minHold: 10_000_000n });
    chain.vault = 1000n;
    await runLiveCycle(deps);
    expect(store.saved!.payoutPool).toBe("400");
    expect(chain.received.size).toBe(0);
  });

  it("stops without sending anything when the treasury holds less than the books say", async () => {
    const { chain, store, deps } = world({ maxSwapPerCycle: 0n, minHold: 10_000_000n });
    chain.vault = 1000n;
    await runLiveCycle(deps); // 400 + 200 + 400 now booked and held
    chain.quote -= 300n; // funds left some other way
    chain.vault = 1000n;
    const sentBefore = chain.sent.length;
    const savedBefore = JSON.stringify(store.saved);
    await expect(runLiveCycle(deps)).rejects.toBeInstanceOf(BooksMismatchError);
    expect(chain.sent.length).toBe(sentBefore);
    expect(JSON.stringify(store.saved)).toBe(savedBefore);
  });

  it("stops when bought-back coin the books count has left the wallet", async () => {
    const { chain, deps } = world();
    chain.vault = 1000n;
    chain.onSend = (kind) => (kind === "buyback_burn" ? "drop" : "land"); // bought back, burn never landed
    await runLiveCycle(deps);
    expect(chain.self).toBe(20_000n);
    chain.self = 0n; // moved out by hand
    await expect(runLiveCycle(deps)).rejects.toBeInstanceOf(BooksMismatchError);
  });

  it("skips the cycle without sending anything when the treasury is low on SOL", async () => {
    const { chain, store, deps } = world({ minSol: 50_000_000n });
    chain.sol = 10_000_000n;
    chain.vault = 1000n;
    await expect(runLiveCycle(deps)).rejects.toBeInstanceOf(LowSolError);
    expect(chain.sent).toEqual([]);
    expect(store.saves).toBe(0);
  });

  it("returns an undeliverable payout to the pool and still pays everyone else", async () => {
    const { chain, store, ledger, deps } = world();
    chain.vault = 1000n;
    chain.rejects.add("bob");
    const report = await runLiveCycle(deps);
    expect(chain.received.get("alice")).toBe(300n);
    expect(chain.received.has("bob")).toBe(false);
    expect(store.saved!.payoutPool).toBe("100");
    expect(store.saved!.payoutQueue).toEqual([]);
    expect(report.skipped.map((s) => s.owner)).toEqual(["bob"]);
    expect(ledger.of("payout_skipped")).toHaveLength(1);
    expect(chain.quote).toBe(bookedQuote(store.saved!));
  });
});

describe("crash safety", () => {
  it("books a claim that landed just before the process died, exactly once", async () => {
    const { chain, store, ledger, deps } = world({ maxSwapPerCycle: 0n, minHold: 10_000_000n });
    chain.vault = 1000n;
    chain.onSend = () => "crash";
    await expect(runLiveCycle(deps)).rejects.toBeInstanceOf(CrashError);
    expect(store.saved!.pending?.kind).toBe("claim"); // recorded before sending
    expect(store.saved!.totals.claimed).toBe("0");

    chain.onSend = () => "land";
    await runLiveCycle(deps);
    expect(store.saved!.totals.claimed).toBe("1000");
    expect(store.saved!.pending).toBeNull();
    expect(ledger.of("claim")).toHaveLength(1);
    expect(chain.quote).toBe(bookedQuote(store.saved!));
  });

  it("books a buyback that landed just before a crash, then burns what it bought", async () => {
    const { chain, store, ledger, deps } = world({ minHold: 10_000_000n });
    chain.vault = 1000n;
    chain.onSend = (kind) => (kind === "buyback" ? "crash" : "land");
    await expect(runLiveCycle(deps)).rejects.toBeInstanceOf(CrashError);
    expect(store.saved!.pending?.kind).toBe("buyback");
    chain.onSend = () => "land";
    await runLiveCycle(deps);
    expect(ledger.of("buyback")).toHaveLength(1);
    expect(ledger.of("buyback_burn")).toHaveLength(1);
    expect(store.saved!.totals.boughtBack).toBe("200");
    expect(store.saved!.totals.selfBurned).toBe("20000");
    expect(store.saved!.selfToBurn).toBe("0");
    expect(chain.self).toBe(0n);
  });

  it("does not pay a holder twice when a payout landed before a crash", async () => {
    const { chain, store, deps } = world({ maxSwapPerCycle: 0n });
    chain.vault = 1000n;
    chain.onSend = (kind) => (kind === "payout" ? "crash" : "land");
    await expect(runLiveCycle(deps)).rejects.toBeInstanceOf(CrashError);
    chain.onSend = () => "land";
    await runLiveCycle(deps);
    expect(chain.received.get("alice")).toBe(300n);
    expect(chain.received.get("bob")).toBe(100n);
    expect(store.saved!.totals.paid).toBe("400");
  });

  it("retries a transaction that expired without landing", async () => {
    const { chain, store, ledger, deps } = world({ maxSwapPerCycle: 0n, minHold: 10_000_000n });
    chain.vault = 1000n;
    chain.onSend = () => "drop";
    const first = await runLiveCycle(deps);
    expect(first.claimed).toBe(0n);
    expect(ledger.of("tx_expired")).toHaveLength(1);
    chain.onSend = () => "land";
    await runLiveCycle(deps);
    expect(store.saved!.totals.claimed).toBe("1000");
  });

  it("refuses to do anything while an earlier transaction is still undecided", async () => {
    const { chain, store, deps } = world();
    store.save({
      ...store.load(MINTS),
      pending: { kind: "claim", signature: "sig-in-limbo", lastValidBlockHeight: 100 },
    });
    chain.vault = 1000n;
    await expect(runLiveCycle(deps)).rejects.toBeInstanceOf(PendingUnresolvedError);
    expect(chain.sent).toEqual([]);
  });
});

describe("a dry run", () => {
  it("sends nothing and writes nothing, and reports what would happen", async () => {
    const { chain, store, ledger, deps } = world({ dryRun: true });
    chain.vault = 1000n;
    const report = await runDryCycle(deps, "probe-wallet");
    expect(chain.sent).toEqual([]);
    expect(store.saves).toBe(0);
    expect(ledger.entries).toEqual([]);
    expect(report.fees).toBe(1000n);
    expect(report.wouldSplit).toEqual({ burn: 400n, buyback: 200n, payout: 400n });
    expect(report.claim.result).toBe("pass");
    expect(report.burn.route.result).toBe("pass");
    expect(report.burn.amount).toBe(400n);
    expect(report.buyback.route.result).toBe("pass");
    expect(report.buyback.amount).toBe(200n);
    expect(report.snapshot.result).toBe("pass");
    expect(report.qualifying).toBe(2);
    expect(report.wouldPay.map((p) => p.amount)).toEqual([300n, 100n]);
    expect(report.payout.result).toBe("pass"); // simulated together with the claim
    expect(report.burn.swap.result).toBe("not_tested"); // no TTWO in the wallet yet
    expect(report.buyback.swap.result).toBe("not_tested");
  });

  it("simulates both swaps once the treasury holds TTWO", async () => {
    const { chain, deps } = world({ dryRun: true });
    chain.vault = 1000n;
    chain.quote = 50n;
    const report = await runDryCycle(deps, "probe-wallet");
    expect(report.burn.swap.result).toBe("pass");
    expect(report.buyback.swap.result).toBe("pass");
    expect(report.burn.expectedOut).toBeNull(); // the probe was smaller than the real swap would be
  });

  it("reports a missing swap route and a blocked snapshot as failures", async () => {
    const { chain, deps } = world({ dryRun: true });
    chain.hasRoute = false;
    chain.hasSelfRoute = false;
    chain.snapshotWorks = false;
    const report = await runDryCycle(deps, "probe-wallet");
    expect(report.burn.route.result).toBe("fail");
    expect(report.burn.swap.result).toBe("fail");
    expect(report.buyback.route.result).toBe("fail");
    expect(report.snapshot.result).toBe("fail");
    expect(report.payout.result).toBe("not_tested");
  });

  it("the live engine refuses to run while DRY_RUN is on", async () => {
    const { chain, deps } = world({ dryRun: true });
    chain.vault = 1000n;
    await expect(runLiveCycle(deps)).rejects.toThrow(/DRY_RUN/);
    expect(chain.sent).toEqual([]);
  });
});
