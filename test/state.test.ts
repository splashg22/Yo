import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileLedger } from "../src/ledger.js";
import {
  FileStateStore, applyClaim, applySwap, bookedQuote, emptyState, reconcile, returnToPool, startPayout,
} from "../src/state.js";
import { MINTS } from "./fakes.js";

describe("the books", () => {
  it("refuse to go negative", () => {
    const state = applyClaim(emptyState(MINTS), 100n);
    expect(() => applySwap(state, 51n, 1n)).toThrow(/negative/);
    expect(() => startPayout(state, [{ owner: "a", amount: 51n }])).toThrow(/negative/);
  });
  it("keep every unit in exactly one place through a distribution", () => {
    let state = applyClaim(emptyState(MINTS), 1001n);
    expect(bookedQuote(state)).toBe(1001n);
    state = startPayout(state, [{ owner: "a", amount: 300n }, { owner: "b", amount: 200n }]);
    expect(bookedQuote(state)).toBe(1001n);
    state = returnToPool(state, [{ owner: "b", amount: "200" }]);
    expect(state.payoutPool).toBe("200");
    expect(bookedQuote(state)).toBe(1001n);
  });
  it("flag a shortfall but tolerate extra tokens in the wallet", () => {
    const state = applyClaim(emptyState(MINTS), 100n);
    expect(reconcile(state, 100n, 0n).ok).toBe(true);
    expect(reconcile(state, 150n, 5n).ok).toBe(true);
    const short = reconcile(state, 99n, 0n);
    expect(short.ok).toBe(false);
    expect(short.quoteDifference).toBe(-1n);
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
