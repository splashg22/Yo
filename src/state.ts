/**
 * The books (data/state.json). Amounts are base units stored as strings.
 *
 * TTWO the bot is holding for a purpose is always in exactly one place:
 *   burnPool     waiting to be swapped into the burn coin (DCTY)
 *   buybackPool  waiting to be swapped into the strategy coin itself
 *   payoutPool   waiting for the next holder distribution
 *   payoutQueue  already allotted to a named holder, transfer not yet confirmed
 * coinToBurn is burn coin bought by the bot and not yet burned; selfToBurn is
 * the same for the strategy coin.
 *
 * `pending` is written BEFORE a transaction is broadcast, so a crash can never
 * lose track of money in flight: the next run looks the signature up first.
 */
import fs from "node:fs";
import path from "node:path";
import { sum } from "./amounts.js";
import { DEFAULT_SPLIT, splitClaim, type Payout, type Split } from "./split.js";

export interface QueueItem {
  owner: string;
  amount: string;
}

/** Which coin a swap buys or a burn destroys: the burn coin (DCTY) or the strategy coin itself. */
export type Target = "burn" | "self";

export type PendingKind = "claim" | "swap" | "burn" | "buyback" | "buyback_burn" | "payout";

export interface Pending {
  kind: PendingKind;
  signature: string;
  lastValidBlockHeight: number;
  /** payout: the queue entries this transaction pays. */
  items?: QueueItem[];
  /** burn / buyback_burn: amount burned. swap / buyback: amount of TTWO sent in. */
  amount?: string;
}

export interface State {
  version: 2;
  strategyMint: string;
  burnMint: string;
  holderMint: string;
  quoteMint: string;
  cycle: number;
  burnPool: string;
  buybackPool: string;
  payoutPool: string;
  coinToBurn: string;
  selfToBurn: string;
  payoutQueue: QueueItem[];
  pending: Pending | null;
  totals: {
    claimed: string;
    /** TTWO spent on the burn coin. */
    swapped: string;
    burned: string;
    /** TTWO spent on the strategy coin. */
    boughtBack: string;
    selfBurned: string;
    paid: string;
  };
}

export interface Mints {
  strategyMint: string;
  burnMint: string;
  holderMint: string;
  quoteMint: string;
}

export function emptyState(mints: Mints): State {
  return {
    version: 2,
    ...mints,
    cycle: 0,
    burnPool: "0",
    buybackPool: "0",
    payoutPool: "0",
    coinToBurn: "0",
    selfToBurn: "0",
    payoutQueue: [],
    pending: null,
    totals: { claimed: "0", swapped: "0", burned: "0", boughtBack: "0", selfBurned: "0", paid: "0" },
  };
}

/** Books written by an earlier version (no buyback yet) are upgraded in place. */
export function upgradeState(raw: unknown): State {
  const state = raw as Partial<State> & { version: number };
  if (state.version === 2) return state as State;
  if (state.version !== 1) throw new Error(`unknown state.json version ${String(state.version)}`);
  const totals = (state.totals ?? {}) as Partial<State["totals"]>;
  return {
    ...(state as Omit<State, "version">),
    version: 2,
    buybackPool: state.buybackPool ?? "0",
    selfToBurn: state.selfToBurn ?? "0",
    totals: {
      claimed: totals.claimed ?? "0",
      swapped: totals.swapped ?? "0",
      burned: totals.burned ?? "0",
      boughtBack: totals.boughtBack ?? "0",
      selfBurned: totals.selfBurned ?? "0",
      paid: totals.paid ?? "0",
    },
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

/** TTWO the books say the treasury must be holding. */
export function bookedQuote(state: State): bigint {
  return BigInt(state.burnPool) + BigInt(state.buybackPool) + BigInt(state.payoutPool) + queueTotal(state.payoutQueue);
}

export function applyClaim(state: State, received: bigint, split: Split = DEFAULT_SPLIT): State {
  if (received < 0n) throw new Error("a claim cannot reduce the treasury balance");
  const { burn, buyback, payout } = splitClaim(received, split);
  return {
    ...state,
    burnPool: add(state.burnPool, burn),
    buybackPool: add(state.buybackPool, buyback),
    payoutPool: add(state.payoutPool, payout),
    totals: { ...state.totals, claimed: add(state.totals.claimed, received) },
  };
}

export function applySwap(state: State, spent: bigint, received: bigint, target: Target = "burn"): State {
  if (spent < 0n || received < 0n) throw new Error("swap amounts cannot be negative");
  if (target === "self") {
    return {
      ...state,
      buybackPool: sub(state.buybackPool, spent, "buyback spent more than the buyback pool"),
      selfToBurn: add(state.selfToBurn, received),
      totals: { ...state.totals, boughtBack: add(state.totals.boughtBack, spent) },
    };
  }
  return {
    ...state,
    burnPool: sub(state.burnPool, spent, "swap spent more than the burn pool"),
    coinToBurn: add(state.coinToBurn, received),
    totals: { ...state.totals, swapped: add(state.totals.swapped, spent) },
  };
}

export function applyBurn(state: State, amount: bigint, target: Target = "burn"): State {
  if (target === "self") {
    return {
      ...state,
      selfToBurn: sub(state.selfToBurn, amount, "burned more strategy coin than was bought back"),
      totals: { ...state.totals, selfBurned: add(state.totals.selfBurned, amount) },
    };
  }
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
  selfBooked: bigint;
  selfHeld: bigint;
  selfDifference: bigint;
  problems: string[];
}

/**
 * The treasury may hold MORE than the books (your own tokens, or tokens
 * someone sent it): the extra is never touched. Holding LESS means the books
 * are wrong or funds left another way, and the bot must stop.
 */
export function reconcile(state: State, quoteHeld: bigint, coinHeld: bigint, selfHeld = 0n): Reconciliation {
  const quoteBooked = bookedQuote(state);
  const coinBooked = BigInt(state.coinToBurn);
  const selfBooked = BigInt(state.selfToBurn);
  const problems: string[] = [];
  if (quoteHeld < quoteBooked) {
    problems.push(
      `treasury holds ${quoteHeld} TTWO base units but the books account for ${quoteBooked}`,
    );
  }
  if (coinHeld < coinBooked) {
    problems.push(
      `treasury holds ${coinHeld} burn-coin base units but the books say ${coinBooked} await burning`,
    );
  }
  if (selfHeld < selfBooked) {
    problems.push(
      `treasury holds ${selfHeld} strategy-coin base units but the books say ${selfBooked} were bought back and await burning`,
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
    selfBooked,
    selfHeld,
    selfDifference: selfHeld - selfBooked,
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
    const state = upgradeState(JSON.parse(fs.readFileSync(this.file, "utf8")));
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
