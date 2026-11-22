/**
 * Which coins to stop following. pump.fun makes a new coin every few seconds, some twenty-five thousand a day, and
 * nearly all of them are dead within the hour. Following every one for ever would fill the database and the board
 * with coins nobody trades.
 *
 * The rule, in the order it is applied:
 *   1. A coin somebody needs is always kept: launched on this site, open in someone's browser, opened lately, or
 *      holding Ring balances. (`needed` says so; this file does not know why.)
 *   2. A coin that has graduated is kept until it has been quiet for a day.
 *   3. A coin still on its curve is dropped when it has been quiet for half an hour and holds less than one SOL
 *      of real buying, or has been quiet for six hours whatever it holds.
 *   4. If more coins are followed than the ceiling allows, the quietest are dropped until it is met.
 *
 * Dropping a coin deletes what this server stored about it. Nothing is lost that the chain does not have: a
 * dropped coin opened by its address is read from the chain again, like any coin never seen before.
 */
import type { Market } from "./model";

export interface RetentionLimits {
  /** A curve coin with less real SOL than `smallLamports` is dropped after this long without a trade. */
  quietSmallMs: number;
  smallLamports: bigint;
  /** Any curve coin is dropped after this long without a trade. */
  quietCurveMs: number;
  /** A graduated coin is dropped after this long without a trade. */
  quietGraduatedMs: number;
  /** The most coins followed at once. */
  ceiling: number;
}
export const DEFAULT_RETENTION: RetentionLimits = {
  quietSmallMs: 30 * 60_000,
  smallLamports: 1_000_000_000n,
  quietCurveMs: 6 * 3_600_000,
  quietGraduatedMs: 24 * 3_600_000,
  ceiling: 20_000,
};

const quietFor = (market: Market, now: number): number => now - (market.lastTradeAt ?? market.createdAt);

/** The coins to stop following now, quietest first. */
export function coinsToDrop(markets: Iterable<Market>, now: number, needed: (mint: string) => boolean, limits = DEFAULT_RETENTION): string[] {
  const drop: string[] = [];
  const kept: Market[] = [];
  for (const market of markets) {
    if (needed(market.mint)) continue;
    const quiet = quietFor(market, now);
    const dead = market.complete
      ? quiet > limits.quietGraduatedMs
      : quiet > limits.quietCurveMs || (quiet > limits.quietSmallMs && market.realSol < limits.smallLamports);
    if (dead) drop.push(market.mint);
    else kept.push(market);
  }
  // The ceiling counts every coin still followed, needed ones included; only coins nobody needs can make room.
  let total = 0;
  for (const _ of markets) total += 1;
  const over = total - drop.length - limits.ceiling;
  if (over > 0) {
    kept.sort((a, b) => quietFor(b, now) - quietFor(a, now));
    for (const market of kept.slice(0, over)) drop.push(market.mint);
  }
  return drop;
}
