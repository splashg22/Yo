import { describe, expect, it } from "vitest";
import {
  BooksMismatchError,
  PendingUnresolvedError,
  runDryCycle,
  runLiveCycle,
  type Deps,
  type Limits,
} from "../src/cycle.js";
import { bookedQuote } from "../src/state.js";
import { CrashError, FakeChain, MemoryLedger, MemoryStore, MINTS } from "./fakes.js";

const LIMITS: Limits = {
  dryRun: false, minHold: 1000n, maxSwapPerCycle: 1_000_000n, minClaim: 0n, minSwap: 0n,
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
  it("claims, splits 50/50, swaps and burns half, pays the other half to qualifying holders", async () => {
    const { chain, store, ledger, deps } = world();
    chain.vault = 1000n;
    const report = await runLiveCycle(deps);

    expect(report.claimed).toBe(1000n);
    expect(report.swapped).toBe(500n);
    expect(chain.burned).toBe(5000n); // 500 TTWO at 10 per unit
    expect(report.burned).toBe(5000n);
    expect(chain.received.get("alice")).toBe(375n); // 3000 / 4000 of 500
    expect(chain.received.get("bob")).toBe(125n);
    expect(chain.received.has("carol")).toBe(false); // below the minimum
    expect(chain.received.has("curve")).toBe(false); // excluded
    expect(chain.quote).toBe(0n);
    expect(chain.coin).toBe(0n);
    expect(bookedQuote(store.saved!)).toBe(0n);
    expect(store.saved!.pending).toBeNull();
    expect(ledger.entries.map((e) => e.type)).toEqual(["claim", "swap", "burn", "distribution", "payout"]);
    expect(report.signatures.every((s) => s.outcome === "confirmed")).toBe(true);
  });

  it("caps the swap and carries the rest of the burn half to later cycles", async () => {
    const { chain, store, deps } = world({ maxSwapPerCycle: 200n });
    chain.vault = 1000n;
    await runLiveCycle(deps);
    expect(store.saved!.burnPool).toBe("300");
    expect(chain.quote).toBe(300n);
    await runLiveCycle(deps);
    expect(store.saved!.burnPool).toBe("100");
    expect(chain.burned).toBe(4000n);
  });

  it("never burns burn-coin the treasury already owned", async () => {
    const { chain, deps } = world();
    chain.coin = 777_777n; // e.g. the owner's own bag
    chain.vault = 1000n;
    await runLiveCycle(deps);
    expect(chain.burned).toBe(5000n);
    expect(chain.coin).toBe(777_777n);
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

  it("keeps the holder half in the books when nobody qualifies yet", async () => {
    const { chain, store, deps } = world({ minHold: 10_000_000n });
    chain.vault = 1000n;
    await runLiveCycle(deps);
    expect(store.saved!.payoutPool).toBe("500");
    expect(chain.received.size).toBe(0);
  });

  it("stops without sending anything when the treasury holds less than the books say", async () => {
    const { chain, store, deps } = world({ maxSwapPerCycle: 0n, minHold: 10_000_000n });
    chain.vault = 1000n;
    await runLiveCycle(deps); // 500 + 500 now booked and held
    chain.quote -= 300n; // funds left some other way
    chain.vault = 1000n;
    const sentBefore = chain.sent.length;
    const savedBefore = JSON.stringify(store.saved);
    await expect(runLiveCycle(deps)).rejects.toBeInstanceOf(BooksMismatchError);
    expect(chain.sent.length).toBe(sentBefore);
    expect(JSON.stringify(store.saved)).toBe(savedBefore);
  });

  it("returns an undeliverable payout to the pool and still pays everyone else", async () => {
    const { chain, store, ledger, deps } = world();
    chain.vault = 1000n;
    chain.rejects.add("bob");
    const report = await runLiveCycle(deps);
    expect(chain.received.get("alice")).toBe(375n);
    expect(chain.received.has("bob")).toBe(false);
    expect(store.saved!.payoutPool).toBe("125");
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

  it("does not pay a holder twice when a payout landed before a crash", async () => {
    const { chain, store, deps } = world({ maxSwapPerCycle: 0n });
    chain.vault = 1000n;
    chain.onSend = (kind) => (kind === "payout" ? "crash" : "land");
    await expect(runLiveCycle(deps)).rejects.toBeInstanceOf(CrashError);
    chain.onSend = () => "land";
    await runLiveCycle(deps);
    expect(chain.received.get("alice")).toBe(375n);
    expect(chain.received.get("bob")).toBe(125n);
    expect(store.saved!.totals.paid).toBe("500");
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
    expect(report.wouldSplit).toEqual({ burn: 500n, payout: 500n });
    expect(report.claim.result).toBe("pass");
    expect(report.route.result).toBe("pass");
    expect(report.snapshot.result).toBe("pass");
    expect(report.qualifying).toBe(2);
    expect(report.wouldPay.map((p) => p.amount)).toEqual([375n, 125n]);
    expect(report.payout.result).toBe("pass"); // simulated together with the claim
    expect(report.swap.result).toBe("not_tested"); // no TTWO in the wallet yet
  });

  it("reports a missing swap route and a blocked snapshot as failures", async () => {
    const { chain, deps } = world({ dryRun: true });
    chain.hasRoute = false;
    chain.snapshotWorks = false;
    const report = await runDryCycle(deps, "probe-wallet");
    expect(report.route.result).toBe("fail");
    expect(report.swap.result).toBe("fail");
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
