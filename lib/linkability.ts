/**
 * Plain warnings before a withdrawal that would be easy for anyone to tie back to a
 * deposit. A Ring hides what happens between Ring balances; the way in and the way out are
 * public, and matching the two by amount or by timing needs no special skill.
 */
import type { RingEvent } from "./contract";

const SOON_MS = 60 * 60 * 1000;

export function withdrawalWarnings(
  history: RingEvent[],
  /** `destinationSeen`: the chain already has transactions for the destination. Undefined: not checked. */
  withdrawal: { wallet: string; mint: string; amount: bigint; destination?: string; destinationSeen?: boolean; balance?: bigint; parts?: number },
  now = Date.now(),
): string[] {
  const warnings: string[] = [];
  const deposits = history.filter((event) => event.kind === "deposit" && event.public.wallet === withdrawal.wallet && event.public.coin === withdrawal.mint);
  const split = (withdrawal.parts ?? 1) > 1;
  if (deposits.some((event) => BigInt(event.public.amount ?? "0") === withdrawal.amount)) {
    warnings.push(
      split
        ? "The parts add up to exactly the amount of a deposit you made. Each part alone matches nothing, but anyone who adds them up can match the total."
        : "This is exactly the amount of a deposit you made. Anyone can match the two by the number alone. A different amount, or several, is harder to match.",
    );
  }
  const latest = deposits.reduce((newest, event) => Math.max(newest, event.at), 0);
  if (latest > 0 && now - latest < SOON_MS) {
    const minutes = Math.max(1, Math.round((now - latest) / 60_000));
    const ago = `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    warnings.push(
      split
        ? `You deposited this coin ${ago}, and the first part goes now. That part is easy to link by its timing; the later ones less so.`
        : `You deposited this coin ${ago}. A withdrawal this soon is easy to link by its timing.`,
    );
  }
  if (deposits.length > 0 && (withdrawal.destination === undefined || withdrawal.destination === "" || withdrawal.destination === withdrawal.wallet)) {
    warnings.push("It goes back to the wallet that deposited, so the chain shows the round trip.");
  }
  const elsewhere = withdrawal.destination !== undefined && withdrawal.destination !== "" && withdrawal.destination !== withdrawal.wallet;
  if (elsewhere && withdrawal.destinationSeen === true) {
    warnings.push(
      "The destination already has a history on the chain. Whatever is known about that address will now be tied to this withdrawal. An address made for this and never used before gives away nothing but itself.",
    );
  }
  if (withdrawal.balance !== undefined && withdrawal.balance > 0n && withdrawal.amount === withdrawal.balance) {
    warnings.push(
      "This empties your Ring balance of this coin. Withdrawing everything at once shows the total you held, and with it the sum of what you were sent.",
    );
  }
  return warnings;
}
