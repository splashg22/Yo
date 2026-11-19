/**
 * The books (data/state.json). Amounts are base units stored as strings.
 *
 * Pair tokens (TTWO, ANT, ...) the bot is holding for a purpose are always in exactly one place:
 *   burnPool     waiting to be swapped into the burn coin
 *   payoutPool   waiting for the next holder distribution
 *   payoutQueue  already allotted to a named holder, transfer not yet confirmed
 * coinToBurn is burn coin bought by the bot and not yet burned.
 *
 * `pending` is written BEFORE a transaction is broadcast, so a crash can never
 * lose track of money in flight: the next run looks the signature up first.
 */
import fs from "node:fs";
import path from "node:path";
import { sum } from "./amounts.js";
import { splitClaim, type Payout } from "./split.js";

export interface QueueItem {
  owner: string;
  amount: string;
}

export type PendingKind = "claim" | "swap" | "burn" | "payout";

export interface Pending {
  kind: PendingKind;
  signature: string;
  lastValidBlockHeight: number;
  /** payout: the queue entries this transaction pays. */
  items?: QueueItem[];
  /** burn: amount burned. swap: amount of the pair token sent in. */
  amount?: string;
}

export interface State {
  version: 1;
  strategyMint: string;
  burnMint: string;
  holderMint: string;
  quoteMint: string;
  cycle: number;
  burnPool: string;
  payoutPool: string;
  coinToBurn: string;
  payoutQueue: QueueItem[];
  pending: Pending | null;
  totals: { claimed: string; swapped: string; burned: string; paid: string };
}

export interface Mints {
  strategyMint: string;
  burnMint: string;
  holderMint: string;
  quoteMint: string;
}

export function emptyState(mints: Mints): State {
  return {
    version: 1,
    ...mints,
    cycle: 0,
    burnPool: "0",
    payoutPool: "0",
    coinToBurn: "0",
    payoutQueue: [],
    pending: null,
    totals: { claimed: "0", swapped: "0", burned: "0", paid: "0" },
  };
}

const add = (a: string, b: bigint) => (BigInt(a) + b).toString();

function sub(a: string, b: bigint, what: string): string {
  const result = BigInt(a) - b;
  if (result < 0n) throw new Error(`books would go negative: ${what} (${a} - ${b})`);
  return result.toString();
}

export function queueTotal(items: readonly QueueItem[]): bigint {
  return sum(items.map((i) => BigInt(i.amount)));
}

/** Pair tokens the books say the treasury must be holding. */
export function bookedQuote(state: State): bigint {
  return BigInt(state.burnPool) + BigInt(state.payoutPool) + queueTotal(state.payoutQueue);
}

export function applyClaim(state: State, received: bigint): State {
  if (received < 0n) throw new Error("a claim cannot reduce the treasury balance");
  const { burn, payout } = splitClaim(received);
  return {
    ...state,
    burnPool: add(state.burnPool, burn),
    payoutPool: add(state.payoutPool, payout),
    totals: { ...state.totals, claimed: add(state.totals.claimed, received) },
  };
}

export function applySwap(state: State, spent: bigint, received: bigint): State {
  if (spent < 0n || received < 0n) throw new Error("swap amounts cannot be negative");
  return {
    ...state,
    burnPool: sub(state.burnPool, spent, "swap spent more than the burn pool"),
    coinToBurn: add(state.coinToBurn, received),
    totals: { ...state.totals, swapped: add(state.totals.swapped, spent) },
  };
}

export function applyBurn(state: State, amount: bigint): State {
  return {
    ...state,
    coinToBurn: sub(state.coinToBurn, amount, "burned more than was bought"),
    totals: { ...state.totals, burned: add(state.totals.burned, amount) },
  };
}

/** Moves a fixed allotment for each holder out of the pool into the queue. */
export function startPayout(state: State, payouts: readonly Payout[]): State {
  if (state.payoutQueue.length > 0) throw new Error("a distribution is already in progress");
  const total = sum(payouts.map((p) => p.amount));
  return {
    ...state,
    payoutPool: sub(state.payoutPool, total, "distribution larger than the payout pool"),
    payoutQueue: payouts.map((p) => ({ owner: p.owner, amount: p.amount.toString() })),
  };
}

function removeFromQueue(queue: readonly QueueItem[], items: readonly QueueItem[]): QueueItem[] {
  const remaining = [...queue];
  for (const item of items) {
    const index = remaining.findIndex((q) => q.owner === item.owner && q.amount === item.amount);
    if (index < 0) throw new Error(`payout to ${item.owner} is not in the queue`);
    remaining.splice(index, 1);
  }
  return remaining;
}

export function applyPayout(state: State, items: readonly QueueItem[]): State {
  return {
    ...state,
    payoutQueue: removeFromQueue(state.payoutQueue, items),
    totals: { ...state.totals, paid: add(state.totals.paid, queueTotal(items)) },
  };
}

/** A payout that cannot be delivered goes back to the pool for the next round. */
export function returnToPool(state: State, items: readonly QueueItem[]): State {
  return {
    ...state,
    payoutQueue: removeFromQueue(state.payoutQueue, items),
    payoutPool: add(state.payoutPool, queueTotal(items)),
  };
}

export interface Reconciliation {
  ok: boolean;
  quoteBooked: bigint;
  quoteHeld: bigint;
  /** Held minus booked. Negative means money is missing. */
  quoteDifference: bigint;
  coinBooked: bigint;
  coinHeld: bigint;
  coinDifference: bigint;
  problems: string[];
}

/**
 * The treasury may hold MORE than the books (your own tokens, or tokens
 * someone sent it): the extra is never touched. Holding LESS means the books
 * are wrong or funds left another way, and the bot must stop.
 */
export function reconcile(state: State, quoteHeld: bigint, coinHeld: bigint): Reconciliation {
  const quoteBooked = bookedQuote(state);
  const coinBooked = BigInt(state.coinToBurn);
  const problems: string[] = [];
  if (quoteHeld < quoteBooked) {
    problems.push(
      `treasury holds ${quoteHeld} base units of the pair token but the books account for ${quoteBooked}`,
    );
  }
  if (coinHeld < coinBooked) {
    problems.push(
      `treasury holds ${coinHeld} burn-coin base units but the books say ${coinBooked} await burning`,
    );
  }
  return {
    ok: problems.length === 0,
    quoteBooked,
    quoteHeld,
    quoteDifference: quoteHeld - quoteBooked,
    coinBooked,
    coinHeld,
    coinDifference: coinHeld - coinBooked,
    problems,
  };
}

export interface StateStore {
  load(mints: Mints): State;
  save(state: State): void;
}

export class FileStateStore implements StateStore {
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "state.json");
  }

  load(mints: Mints): State {
    if (!fs.existsSync(this.file)) return emptyState(mints);
    const state = JSON.parse(fs.readFileSync(this.file, "utf8")) as State;
    if (state.version !== 1) throw new Error(`unknown state.json version ${String(state.version)}`);
    for (const key of ["strategyMint", "burnMint", "holderMint", "quoteMint"] as const) {
      if (state[key] !== mints[key]) {
        throw new Error(
          `state.json was written for ${key} ${state[key]} but the bot is now configured for ` +
            `${mints[key]}. Refusing to mix two sets of books.`,
        );
      }
    }
    return state;
  }

  /** Atomic: write a temp file, keep the previous version as .bak, rename. */
  save(state: State): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeSync(fd, `${JSON.stringify(state, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    fs.renameSync(tmp, this.file);
  }
}
