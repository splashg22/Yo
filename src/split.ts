/**
 * The money rules. Pure functions, no chain access.
 *
 *  - Every claim is split three ways by fixed percentages (default 40/20/40):
 *      burn     buys the burn coin (DCTY) and burns it
 *      buyback  buys the strategy coin itself and burns it
 *      holders  paid out in TTWO to qualifying holders
 *    Rounding dust (at most two base units) goes to the burn share.
 *  - A holder qualifies with a balance >= minHold and is not excluded.
 *  - Qualifying holders are paid in proportion to their balance, rounded
 *    down. What rounding leaves over stays in the pool for the next round.
 */
import { sum } from "./amounts.js";

export interface Payout {
  owner: string;
  amount: bigint;
}

/** Whole percentages. They must add up to 100. */
export interface Split {
  burn: number;
  buyback: number;
  holders: number;
}

export const DEFAULT_SPLIT: Split = { burn: 40, buyback: 20, holders: 40 };

export function checkSplit(split: Split): Split {
  for (const [name, value] of Object.entries(split)) {
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new Error(`${name} share must be a whole number between 0 and 100, got ${String(value)}`);
    }
  }
  const total = split.burn + split.buyback + split.holders;
  if (total !== 100) throw new Error(`the shares must add up to 100, they add up to ${total}`);
  return split;
}

export function splitClaim(claimed: bigint, split: Split = DEFAULT_SPLIT): { burn: bigint; buyback: bigint; payout: bigint } {
  if (claimed < 0n) throw new Error("claimed amount cannot be negative");
  checkSplit(split);
  const payout = (claimed * BigInt(split.holders)) / 100n;
  const buyback = (claimed * BigInt(split.buyback)) / 100n;
  return { burn: claimed - payout - buyback, buyback, payout };
}

export function eligibleHolders(
  balances: ReadonlyMap<string, bigint>,
  minHold: bigint,
  excluded: ReadonlySet<string>,
): Payout[] {
  const holders: Payout[] = [];
  for (const [owner, amount] of balances) {
    if (amount <= 0n || amount < minHold || excluded.has(owner)) continue;
    holders.push({ owner, amount });
  }
  // Largest first, ties by address, so every run orders them the same way.
  return holders.sort((a, b) =>
    a.amount === b.amount ? (a.owner < b.owner ? -1 : 1) : a.amount > b.amount ? -1 : 1,
  );
}

export function allocate(
  pool: bigint,
  holders: readonly Payout[],
  minPayout = 0n,
): { payouts: Payout[]; remainder: bigint } {
  if (pool < 0n) throw new Error("pool cannot be negative");
  const totalHeld = sum(holders.map((h) => h.amount));
  if (pool === 0n || totalHeld === 0n) return { payouts: [], remainder: pool };
  const payouts: Payout[] = [];
  for (const holder of holders) {
    const share = (pool * holder.amount) / totalHeld;
    if (share > 0n && share >= minPayout) payouts.push({ owner: holder.owner, amount: share });
  }
  return { payouts, remainder: pool - sum(payouts.map((p) => p.amount)) };
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be at least 1");
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
