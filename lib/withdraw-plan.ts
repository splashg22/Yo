/**
 * Splitting a withdrawal into several, spread over time.
 *
 * Why: a withdrawal shows its amount and its time to everyone. One withdrawal of exactly what was paid in, or
 * of everything a wallet received, minutes afterwards, can be matched to what went in by the number and the
 * clock alone. Several uneven amounts at uneven times give an observer much less to match.
 *
 * What it does not do: it does not hide the withdrawing wallet, the destination or the coin, and the parts
 * still add up. It makes matching by amount and timing harder; it does not make it impossible.
 *
 * Pure: the same inputs and the same random numbers give the same plan. The wallet page runs the plan.
 */
export interface PlannedPart {
  /** Base units. */
  amount: bigint;
  /** Milliseconds after the plan starts. The first part is at 0: it goes now. */
  afterMs: number;
}
export const MOST_PARTS = 8;
export const LONGEST_HOURS = 72;

/** A random whole number from 0 up to but not including `below`, from the browser's own source of randomness. */
export function randomBelow(below: number): number {
  if (!Number.isInteger(below) || below <= 0 || below > 2 ** 32) throw new Error("the range is out of bounds");
  // Rejection sampling: numbers above the last whole multiple of `below` are thrown away, so none is favoured.
  const limit = Math.floor(2 ** 32 / below) * below;
  const draw = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(draw);
    if (draw[0]! < limit) return draw[0]! % below;
  }
}

/**
 * Splits `total` into `parts` uneven amounts that add up to it exactly, each at least `smallest`, and spreads
 * them over `overMs`. `random(below)` returns a whole number from 0 up to but not including `below`.
 */
export function planWithdrawal(input: { total: bigint; parts: number; overMs: number; smallest: bigint; random?: (below: number) => number }): PlannedPart[] {
  const { total, parts, overMs, smallest } = input;
  const random = input.random ?? randomBelow;
  if (!Number.isInteger(parts) || parts < 1 || parts > MOST_PARTS) throw new Error(`a withdrawal can be split into 1 to ${MOST_PARTS} parts`);
  if (total <= 0n) throw new Error("the amount must be above zero");
  if (smallest <= 0n) throw new Error("the smallest part must be above zero");
  if (!Number.isFinite(overMs) || overMs < 0 || overMs > LONGEST_HOURS * 3_600_000) throw new Error(`a plan can run for at most ${LONGEST_HOURS} hours`);
  if (total < smallest * BigInt(parts)) throw new Error("the amount is too small to split into that many parts");
  if (parts === 1) return [{ amount: total, afterMs: 0 }];

  // Every part gets the smallest amount; what is left over is cut at random points. Shares are in millionths.
  const spare = total - smallest * BigInt(parts);
  const cuts = Array.from({ length: parts - 1 }, () => random(1_000_001)).sort((a, b) => a - b);
  const edges = [0, ...cuts, 1_000_000];
  const amounts = edges.slice(1).map((edge, index) => smallest + (spare * BigInt(edge - edges[index]!)) / 1_000_000n);
  // Rounding down each share leaves a few base units over; they go to one part chosen at random.
  const given = amounts.reduce((sum, amount) => sum + amount, 0n);
  amounts[random(parts)]! += total - given;

  // Times: the first part goes now; the rest at random moments in the window, at least a minute apart when the window allows.
  const gap = Math.min(60_000, Math.floor(overMs / parts));
  const free = Math.max(0, overMs - gap * (parts - 1));
  const offsets = Array.from({ length: parts - 1 }, () => random(free + 1)).sort((a, b) => a - b);
  return amounts.map((amount, index) => ({ amount, afterMs: index === 0 ? 0 : offsets[index - 1]! + gap * index }));
}
