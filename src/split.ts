/**
 * The money rules. Pure functions, no chain access.
 *
 *  - Every claim is split 50/50: half buys and burns, half goes to holders.
 *    An odd base unit goes to the burn side.
 *  - A holder qualifies with a balance >= minHold and is not excluded.
 *  - Qualifying holders are paid in proportion to their balance, rounded
 *    down. What rounding leaves over stays in the pool for the next round.
 */
import { sum } from "./amounts.js";

export interface Payout {
  owner: string;
  amount: bigint;
}

export function splitClaim(claimed: bigint): { burn: bigint; payout: bigint } {
  if (claimed < 0n) throw new Error("claimed amount cannot be negative");
  const payout = claimed / 2n;
  return { burn: claimed - payout, payout };
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
