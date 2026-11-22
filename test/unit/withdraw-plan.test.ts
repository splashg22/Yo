import { describe, expect, it } from "vitest";
import { LONGEST_HOURS, MOST_PARTS, planWithdrawal, randomBelow } from "../../lib/withdraw-plan";

/** A repeatable source of "random" numbers, so a plan can be checked exactly. */
function seeded(seed: number): (below: number) => number {
  let state = seed;
  return (below) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state % below;
  };
}

describe("a split withdrawal", () => {
  it("adds up to exactly the amount asked for, every time, with no part below the smallest", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const total = BigInt(seed) * 1_234_567_891n + 7n;
      const parts = (seed % MOST_PARTS) + 1;
      const smallest = total / BigInt(parts * 20) + 1n;
      const plan = planWithdrawal({ total, parts, overMs: 3_600_000, smallest, random: seeded(seed) });
      expect(plan).toHaveLength(parts);
      expect(plan.reduce((sum, part) => sum + part.amount, 0n)).toBe(total);
      for (const part of plan) expect(part.amount).toBeGreaterThanOrEqual(smallest);
    }
  });

  it("sends the first part now and the rest later, in order, inside the time asked for, at least a minute apart", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const plan = planWithdrawal({ total: 10_000_000_000n, parts: 5, overMs: 6 * 3_600_000, smallest: 1_000_000n, random: seeded(seed) });
      expect(plan[0]!.afterMs).toBe(0);
      for (let index = 1; index < plan.length; index++) {
        expect(plan[index]!.afterMs - plan[index - 1]!.afterMs).toBeGreaterThanOrEqual(60_000);
        expect(plan[index]!.afterMs).toBeLessThanOrEqual(6 * 3_600_000);
      }
    }
  });

  it("makes parts that differ from one another and from an even split", () => {
    let uneven = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const plan = planWithdrawal({ total: 9_000_000_000n, parts: 3, overMs: 0, smallest: 1_000n, random: seeded(seed) });
      if (new Set(plan.map((part) => part.amount)).size === 3 && !plan.some((part) => part.amount === 3_000_000_000n)) uneven += 1;
    }
    expect(uneven).toBeGreaterThanOrEqual(49);
  });

  it("is one withdrawal, now, when asked for one part, and all at once when given no time", () => {
    expect(planWithdrawal({ total: 5n, parts: 1, overMs: 3_600_000, smallest: 1n })).toEqual([{ amount: 5n, afterMs: 0 }]);
    expect(planWithdrawal({ total: 500n, parts: 4, overMs: 0, smallest: 1n }).map((part) => part.afterMs)).toEqual([0, 0, 0, 0]);
  });

  it("refuses what cannot be planned, in a plain sentence", () => {
    const base = { total: 100n, parts: 2, overMs: 0, smallest: 1n };
    expect(() => planWithdrawal({ ...base, parts: 0 })).toThrow(/1 to 8 parts/);
    expect(() => planWithdrawal({ ...base, parts: MOST_PARTS + 1 })).toThrow(/1 to 8 parts/);
    expect(() => planWithdrawal({ ...base, parts: 1.5 })).toThrow(/1 to 8 parts/);
    expect(() => planWithdrawal({ ...base, total: 0n })).toThrow(/above zero/);
    expect(() => planWithdrawal({ ...base, smallest: 0n })).toThrow(/smallest part/);
    expect(() => planWithdrawal({ ...base, smallest: 51n })).toThrow(/too small to split/);
    expect(() => planWithdrawal({ ...base, overMs: (LONGEST_HOURS + 1) * 3_600_000 })).toThrow(/at most 72 hours/);
    expect(() => planWithdrawal({ ...base, overMs: -1 })).toThrow(/at most 72 hours/);
  });

  it("draws its numbers from the browser's own randomness, evenly", () => {
    const counts = [0, 0, 0];
    for (let draw = 0; draw < 3000; draw++) counts[randomBelow(3)]! += 1;
    for (const count of counts) expect(count).toBeGreaterThan(800);
    expect(() => randomBelow(0)).toThrow(/out of bounds/);
    // Two plans of the same withdrawal are not the same plan.
    const plans = new Set(
      Array.from({ length: 20 }, () =>
        planWithdrawal({ total: 10n ** 12n, parts: 4, overMs: 3_600_000, smallest: 1n })
          .map((part) => part.amount)
          .join(),
      ),
    );
    expect(plans.size).toBeGreaterThan(15);
  });
});
