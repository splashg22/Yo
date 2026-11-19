import { describe, expect, it } from "vitest";
import { formatUnits, parseUnits } from "../src/amounts.js";
import { parseConfig } from "../src/config.js";
import { aggregateByOwner, decodeOwnerAmount } from "../src/holders.js";
import { allocate, checkSplit, chunk, eligibleHolders, splitClaim } from "../src/split.js";
import { tokenDelta } from "../src/txmeta.js";
import { PublicKey } from "@solana/web3.js";

describe("amounts", () => {
  it("converts whole tokens to base units exactly", () => {
    expect(parseUnits("1.5", 6)).toBe(1_500_000n);
    expect(parseUnits("0.000001", 6)).toBe(1n);
    expect(parseUnits("12", 0)).toBe(12n);
  });
  it("rejects anything that is not a plain number", () => {
    for (const bad of ["-1", "1e3", "abc", "", "1.2345678"]) expect(() => parseUnits(bad, 6)).toThrow();
  });
  it("formats base units back", () => {
    expect(formatUnits(1_500_000n, 6)).toBe("1.5");
    expect(formatUnits(1n, 8)).toBe("0.00000001");
    expect(formatUnits(0n, 6)).toBe("0");
  });
});

describe("the split", () => {
  it("is 40% burn, 20% buyback, 40% holders by default", () => {
    expect(splitClaim(1000n)).toEqual({ burn: 400n, buyback: 200n, payout: 400n });
  });
  it("gives rounding dust to the burn and never loses a unit", () => {
    for (const claimed of [1n, 7n, 101n, 999n, 123_456_789n]) {
      const { burn, buyback, payout } = splitClaim(claimed);
      expect(burn + buyback + payout).toBe(claimed);
      expect(payout).toBe((claimed * 40n) / 100n);
      expect(buyback).toBe((claimed * 20n) / 100n);
    }
    expect(splitClaim(7n)).toEqual({ burn: 4n, buyback: 1n, payout: 2n });
  });
  it("follows any split that adds up to 100", () => {
    expect(splitClaim(100n, { burn: 50, buyback: 0, holders: 50 })).toEqual({ burn: 50n, buyback: 0n, payout: 50n });
    expect(splitClaim(300n, { burn: 0, buyback: 100, holders: 0 })).toEqual({ burn: 0n, buyback: 300n, payout: 0n });
  });
  it("refuses shares that do not add up to 100 or are not whole percentages", () => {
    expect(() => checkSplit({ burn: 50, buyback: 30, holders: 30 })).toThrow(/add up to 100/);
    expect(() => checkSplit({ burn: 40.5, buyback: 19.5, holders: 40 })).toThrow(/whole number/);
    expect(() => checkSplit({ burn: -10, buyback: 70, holders: 40 })).toThrow(/whole number/);
    expect(() => splitClaim(100n, { burn: 1, buyback: 1, holders: 1 })).toThrow();
  });
});

describe("who qualifies", () => {
  const balances = new Map([["alice", 1000n], ["bob", 999n], ["carol", 5000n], ["pool", 900_000n]]);
  it("keeps holders at or above the minimum and drops excluded wallets", () => {
    const holders = eligibleHolders(balances, 1000n, new Set(["pool"]));
    expect(holders.map((h) => h.owner)).toEqual(["carol", "alice"]);
  });
});

describe("payout allocation", () => {
  const holders = [{ owner: "carol", amount: 5000n }, { owner: "alice", amount: 1000n }];
  it("pays in proportion to balance", () => {
    const { payouts, remainder } = allocate(600n, holders);
    expect(payouts).toEqual([{ owner: "carol", amount: 500n }, { owner: "alice", amount: 100n }]);
    expect(remainder).toBe(0n);
  });
  it("never pays out more than the pool; rounding dust is carried", () => {
    const three = [1n, 1n, 1n].map((amount, i) => ({ owner: `h${i}`, amount }));
    const { payouts, remainder } = allocate(100n, three);
    expect(payouts.every((p) => p.amount === 33n)).toBe(true);
    expect(remainder).toBe(1n);
  });
  it("holds back shares below the minimum payout", () => {
    const { payouts, remainder } = allocate(600n, holders, 200n);
    expect(payouts).toEqual([{ owner: "carol", amount: 500n }]);
    expect(remainder).toBe(100n);
  });
  it("pays nobody when nobody qualifies", () => {
    expect(allocate(600n, [])).toEqual({ payouts: [], remainder: 600n });
  });
  it("chunks payouts into transactions", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("holder snapshot", () => {
  it("adds up several token accounts of one wallet and ignores empty ones", () => {
    const totals = aggregateByOwner([
      { owner: "alice", amount: 5n }, { owner: "alice", amount: 7n }, { owner: "bob", amount: 0n },
    ]);
    expect([...totals]).toEqual([["alice", 12n]]);
  });
  it("decodes owner and amount from raw token account bytes", () => {
    const owner = new PublicKey("So11111111111111111111111111111111111111112");
    const slice = Buffer.alloc(40);
    owner.toBuffer().copy(slice, 0);
    slice.writeBigUInt64LE(123_456n, 32);
    expect(decodeOwnerAmount(slice)).toEqual({ owner: owner.toBase58(), amount: 123_456n });
  });
});

describe("reading a confirmed transaction", () => {
  const row = (accountIndex: number, owner: string, mint: string, amount: string) =>
    ({ accountIndex, owner, mint, uiTokenAmount: { amount } });
  it("measures what the treasury really received", () => {
    const meta = {
      preTokenBalances: [row(1, "treasury", "TTWO", "10"), row(2, "vault", "TTWO", "500")],
      postTokenBalances: [row(1, "treasury", "TTWO", "510"), row(2, "vault", "TTWO", "0")],
    };
    expect(tokenDelta(meta, "treasury", "TTWO")).toBe(500n);
  });
  it("counts an account created inside the transaction from zero", () => {
    const meta = { preTokenBalances: [], postTokenBalances: [row(3, "treasury", "DCTY", "42")] };
    expect(tokenDelta(meta, "treasury", "DCTY")).toBe(42n);
    expect(tokenDelta(meta, "treasury", "TTWO")).toBe(0n);
  });
});

describe("config", () => {
  const mint = "So11111111111111111111111111111111111111112";
  const env = {
    RPC_URL: "https://example.invalid", TREASURY_KEYPAIR_PATH: "/keys/t.json", STRATEGY_MINT: mint,
    BURN_MINT: mint, HOLDER_MINT: mint, MIN_HOLD: "1000", MAX_SWAP_TTWO_PER_CYCLE: "1",
  };
  it("is a dry run unless DRY_RUN is exactly false", () => {
    expect(parseConfig(env).dryRun).toBe(true);
    expect(parseConfig({ ...env, DRY_RUN: "true" }).dryRun).toBe(true);
    expect(parseConfig({ ...env, DRY_RUN: "false" }).dryRun).toBe(false);
    expect(() => parseConfig({ ...env, DRY_RUN: "no" })).toThrow();
  });
  it("refuses missing or malformed settings", () => {
    expect(() => parseConfig({ ...env, RPC_URL: "" })).toThrow(/RPC_URL/);
    expect(() => parseConfig({ ...env, STRATEGY_MINT: "not-an-address" })).toThrow(/STRATEGY_MINT/);
    expect(() => parseConfig({ ...env, MIN_HOLD: "lots" })).toThrow(/MIN_HOLD/);
  });
  it("reads the split and insists it adds up to 100", () => {
    expect(parseConfig(env).split).toEqual({ burn: 40, buyback: 20, holders: 40 });
    expect(parseConfig({ ...env, BURN_SHARE_PERCENT: "50", BUYBACK_SHARE_PERCENT: "0", HOLDER_SHARE_PERCENT: "50" }).split).toEqual({ burn: 50, buyback: 0, holders: 50 });
    expect(() => parseConfig({ ...env, BURN_SHARE_PERCENT: "50" })).toThrow(/add up to 100/);
    expect(() => parseConfig({ ...env, BUYBACK_SHARE_PERCENT: "abc" })).toThrow(/BUYBACK_SHARE_PERCENT/);
  });
});
