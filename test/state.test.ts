import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileLedger } from "../src/ledger.js";
import {
  FileStateStore, applyBurn, applyClaim, applySwap, bookedQuote, emptyState, reconcile, returnToPool, startPayout, upgradeState,
} from "../src/state.js";
import { MINTS } from "./fakes.js";

describe("the books", () => {
  it("refuse to go negative", () => {
    const state = applyClaim(emptyState(MINTS), 100n);
    expect(() => applySwap(state, 41n, 1n)).toThrow(/negative/);
    expect(() => applySwap(state, 21n, 1n, "self")).toThrow(/negative/);
    expect(() => applyBurn(state, 1n, "self")).toThrow(/negative/);
    expect(() => startPayout(state, [{ owner: "a", amount: 41n }])).toThrow(/negative/);
  });
  it("put each share of a claim in its own pool", () => {
    const state = applyClaim(emptyState(MINTS), 1000n);
    expect(state).toMatchObject({ burnPool: "400", buybackPool: "200", payoutPool: "400" });
    expect(bookedQuote(state)).toBe(1000n);
    const bought = applySwap(state, 200n, 20_000n, "self");
    expect(bought).toMatchObject({ buybackPool: "0", selfToBurn: "20000", totals: { boughtBack: "200" } });
    expect(bookedQuote(bought)).toBe(800n);
    const burned = applyBurn(bought, 20_000n, "self");
    expect(burned).toMatchObject({ selfToBurn: "0", totals: { selfBurned: "20000" } });
  });
  it("keep every unit in exactly one place through a distribution", () => {
    let state = applyClaim(emptyState(MINTS), 1001n);
    expect(bookedQuote(state)).toBe(1001n);
    state = startPayout(state, [{ owner: "a", amount: 300n }, { owner: "b", amount: 100n }]);
    expect(bookedQuote(state)).toBe(1001n);
    state = returnToPool(state, [{ owner: "b", amount: "100" }]);
    expect(state.payoutPool).toBe("100");
    expect(bookedQuote(state)).toBe(1001n);
  });
  it("flag a shortfall but tolerate extra tokens in the wallet", () => {
    const state = applyClaim(emptyState(MINTS), 100n);
    expect(reconcile(state, 100n, 0n, 0n).ok).toBe(true);
    expect(reconcile(state, 150n, 5n, 7n).ok).toBe(true);
    const short = reconcile(state, 99n, 0n, 0n);
    expect(short.ok).toBe(false);
    expect(short.quoteDifference).toBe(-1n);
    const missingSelf = reconcile(applySwap(state, 20n, 2000n, "self"), 80n, 0n, 1999n);
    expect(missingSelf.ok).toBe(false);
    expect(missingSelf.selfDifference).toBe(-1n);
  });
  it("upgrade books written before the buyback existed", () => {
    const old = {
      version: 1, ...MINTS, cycle: 3, burnPool: "5", payoutPool: "6", coinToBurn: "7", payoutQueue: [], pending: null,
      totals: { claimed: "100", swapped: "40", burned: "400", paid: "30" },
    };
    const state = upgradeState(old);
    expect(state).toMatchObject({ version: 2, cycle: 3, burnPool: "5", buybackPool: "0", selfToBurn: "0", totals: { boughtBack: "0", selfBurned: "0", paid: "30" } });
    expect(bookedQuote(state)).toBe(11n);
    expect(() => upgradeState({ version: 9 })).toThrow(/version/);
  });
});

describe("files in data/", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-"));
  it("state survives a save and load, with a backup of the previous version", () => {
    const dir = tmp();
    const store = new FileStateStore(dir);
    const first = applyClaim(emptyState(MINTS), 100n);
    store.save(first);
    store.save(applyClaim(first, 50n));
    expect(store.load(MINTS).totals.claimed).toBe("150");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "state.json.bak"), "utf8")).totals.claimed).toBe("100");
  });
  it("refuses books written for a different coin", () => {
    const dir = tmp();
    const store = new FileStateStore(dir);
    store.save(emptyState(MINTS));
    expect(() => store.load({ ...MINTS, strategyMint: "OTHER" })).toThrow(/Refusing/);
  });
  it("the ledger appends one JSON line per event and can find a signature", () => {
    const dir = tmp();
    const ledger = new FileLedger(dir);
    ledger.append({ type: "claim", cycle: 1, signature: "abc", claimed: "10" });
    ledger.append({ type: "burn", cycle: 1, signature: "def", burned: "5" });
    const lines = fs.readFileSync(path.join(dir, "ledger.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).claimed).toBe("10");
    expect(ledger.has("claim", "abc")).toBe(true);
    expect(ledger.has("burn", "abc")).toBe(false);
  });
});
