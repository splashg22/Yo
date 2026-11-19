/**
 * One cycle: claim fees -> split (default 40/20/40) -> buy + burn DCTY ->
 * buy back + burn the strategy coin -> pay holders in TTWO.
 *
 * This file decides WHAT happens and keeps the books. It never talks to
 * Solana directly: everything on-chain goes through the `Chain` interface
 * (src/chain.ts), which lets the tests drive it with a fake chain.
 */
import { min, sum } from "./amounts.js";
import type { Ledger } from "./ledger.js";
import { allocate, eligibleHolders, splitClaim, type Split } from "./split.js";
import {
  applyBurn,
  applyClaim,
  applyPayout,
  applySwap,
  reconcile,
  returnToPool,
  startPayout,
  type Mints,
  type Pending,
  type PendingKind,
  type QueueItem,
  type Reconciliation,
  type State,
  type StateStore,
  type Target,
} from "./state.js";

export interface Built {
  signature: string;
  lastValidBlockHeight: number;
  raw: Uint8Array;
}

export type TxStatus = "confirmed" | "failed" | "expired" | "unknown";

export interface SimResult {
  ok: boolean;
  error?: string;
}

export interface HolderSnapshot {
  /** owner wallet -> total balance in base units */
  balances: Map<string, bigint>;
  excluded: Set<string>;
  source: string;
}

/** The treasury's holdings: SOL (lamports), TTWO, the burn coin, the strategy coin. */
export interface Holdings {
  sol: bigint;
  quote: bigint;
  coin: bigint;
  self: bigint;
}

export interface Chain {
  mints(): Mints;
  balances(): Promise<Holdings>;
  /** Creator fees waiting to be claimed, in TTWO base units. */
  pendingFees(): Promise<bigint>;
  buildClaim(): Promise<Built>;
  /** Human description of the TTWO -> target coin route. Throws when there is none. */
  describeRoute(target: Target): Promise<string>;
  buildSwap(amountIn: bigint, target: Target): Promise<Built & { expectedOut: bigint; minOut: bigint }>;
  buildBurn(amount: bigint, target: Target): Promise<Built>;
  buildPayout(items: readonly QueueItem[], options?: { withClaim?: boolean }): Promise<Built>;
  simulate(built: Built): Promise<SimResult>;
  send(built: Built): Promise<void>;
  status(signature: string, lastValidBlockHeight: number): Promise<TxStatus>;
  /** Change in the treasury's own token balances caused by a confirmed transaction. */
  deltas(signature: string): Promise<{ quote: bigint; coin: bigint; self: bigint }>;
  snapshotHolders(): Promise<HolderSnapshot>;
}

/** All amounts in base units. */
export interface Limits {
  dryRun: boolean;
  split: Split;
  minHold: bigint;
  /** Lamports. A live cycle is skipped below this. */
  minSol: bigint;
  /** Applies to each swap (DCTY and buyback) separately. */
  maxSwapPerCycle: bigint;
  minClaim: bigint;
  minSwap: bigint;
  minDistribute: bigint;
  minPayout: bigint;
  payoutsPerTx: number;
}

export interface Deps {
  chain: Chain;
  store: StateStore;
  ledger: Ledger;
  limits: Limits;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for a transaction before giving up for this run. */
  confirmTimeoutMs?: number;
}

export class BooksMismatchError extends Error {
  constructor(readonly reconciliation: Reconciliation) {
    super(`Books and treasury disagree: ${reconciliation.problems.join("; ")}`);
  }
}

export class LowSolError extends Error {
  constructor(readonly held: bigint, readonly needed: bigint) {
    super(`The treasury has ${held} lamports of SOL, below MIN_SOL_BALANCE (${needed}). Nothing was sent; top it up.`);
  }
}

export class PendingUnresolvedError extends Error {
  constructor(readonly pending: Pending) {
    super(
      `Transaction ${pending.signature} (${pending.kind}) is neither confirmed nor expired yet. ` +
        `Nothing else was done; run again in a minute.`,
    );
  }
}

type Outcome = "confirmed" | "failed" | "expired" | "sim_failed";

interface Executed {
  state: State;
  outcome: Outcome;
  signature?: string;
  error?: string;
}

export interface LiveReport {
  mode: "live";
  cycle: number;
  signatures: { kind: PendingKind; signature: string; outcome: Outcome }[];
  claimed: bigint;
  swapped: bigint;
  burned: bigint;
  boughtBack: bigint;
  selfBurned: bigint;
  paid: bigint;
  recipients: number;
  skipped: { owner: string; amount: string; reason: string }[];
  notes: string[];
  state: State;
}

const SWAP_KIND: Record<Target, PendingKind> = { burn: "swap", self: "buyback" };
const BURN_KIND: Record<Target, PendingKind> = { burn: "burn", self: "buyback_burn" };

async function waitFor(deps: Deps, built: { signature: string; lastValidBlockHeight: number }) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (deps.confirmTimeoutMs ?? 240_000);
  for (;;) {
    const status = await deps.chain.status(built.signature, built.lastValidBlockHeight);
    if (status !== "unknown") return status;
    if (Date.now() >= deadline) return "unknown" as const;
    await sleep(2500);
  }
}

/** Books a finished transaction. Safe to call again after a crash. */
async function settle(deps: Deps, state: State, status: Exclude<TxStatus, "unknown">): Promise<State> {
  const pending = state.pending;
  if (!pending) return state;
  const { chain, ledger, store, limits } = deps;
  let next = state;
  if (status === "confirmed") {
    const base = { cycle: state.cycle, signature: pending.signature };
    if (pending.kind === "claim") {
      const { quote } = await chain.deltas(pending.signature);
      next = applyClaim(state, quote, limits.split);
      const { burn, buyback, payout } = splitClaim(quote, limits.split);
      if (!ledger.has("claim", pending.signature)) {
        ledger.append({
          type: "claim", ...base, claimed: quote.toString(),
          toBurn: burn.toString(), toBuyback: buyback.toString(), toHolders: payout.toString(),
        });
      }
    } else if (pending.kind === "swap" || pending.kind === "buyback") {
      const target: Target = pending.kind === "swap" ? "burn" : "self";
      const { quote, coin, self } = await chain.deltas(pending.signature);
      const received = target === "burn" ? coin : self;
      next = applySwap(state, -quote, received, target);
      if (!ledger.has(pending.kind, pending.signature)) {
        ledger.append({ type: pending.kind, ...base, spent: (-quote).toString(), bought: received.toString() });
      }
    } else if (pending.kind === "burn" || pending.kind === "buyback_burn") {
      const amount = BigInt(pending.amount ?? "0");
      next = applyBurn(state, amount, pending.kind === "burn" ? "burn" : "self");
      if (!ledger.has(pending.kind, pending.signature)) {
        ledger.append({ type: pending.kind, ...base, burned: amount.toString() });
      }
    } else {
      const items = pending.items ?? [];
      next = applyPayout(state, items);
      if (!ledger.has("payout", pending.signature)) {
        ledger.append({ type: "payout", ...base, payouts: items });
      }
    }
  } else {
    const type = status === "failed" ? "tx_failed" : "tx_expired";
    if (!ledger.has(type, pending.signature)) {
      ledger.append({ type, cycle: state.cycle, signature: pending.signature, kind: pending.kind });
    }
  }
  next = { ...next, pending: null };
  store.save(next);
  return next;
}

async function execute(
  deps: Deps,
  state: State,
  kind: PendingKind,
  build: () => Promise<Built>,
  extra: Pick<Pending, "items" | "amount"> = {},
): Promise<Executed> {
  if (deps.limits.dryRun) throw new Error("refusing to send a transaction in a dry run");
  const built = await build();
  const sim = await deps.chain.simulate(built);
  if (!sim.ok) return { state, outcome: "sim_failed", error: sim.error };

  // Written before broadcasting: a crash from here on is recoverable.
  let next: State = {
    ...state,
    pending: { kind, signature: built.signature, lastValidBlockHeight: built.lastValidBlockHeight, ...extra },
  };
  deps.store.save(next);
  try {
    await deps.chain.send(built);
  } catch (error) {
    // It may still have reached the network. Only the chain can tell us.
    deps.log?.(`send reported an error (${(error as Error).message}); checking the chain`);
  }
  const status = await waitFor(deps, built);
  if (status === "unknown") throw new PendingUnresolvedError(next.pending!);
  next = await settle(deps, next, status);
  return { state: next, outcome: status, signature: built.signature };
}

export async function runLiveCycle(deps: Deps): Promise<LiveReport> {
  const { chain, store, ledger, limits } = deps;
  const log = deps.log ?? (() => {});
  if (limits.dryRun) throw new Error("runLiveCycle called while DRY_RUN is on");

  let state = store.load(chain.mints());
  const report: LiveReport = {
    mode: "live", cycle: 0, signatures: [], claimed: 0n, swapped: 0n, burned: 0n, boughtBack: 0n, selfBurned: 0n, paid: 0n,
    recipients: 0, skipped: [], notes: [], state,
  };
  const before = state.totals;

  // 1. Finish whatever an earlier run left in flight.
  if (state.pending) {
    const pending = state.pending;
    log(`resolving ${pending.kind} transaction ${pending.signature} from an earlier run`);
    const status = await waitFor(deps, pending);
    if (status === "unknown") throw new PendingUnresolvedError(pending);
    state = await settle(deps, state, status);
    report.signatures.push({ kind: pending.kind, signature: pending.signature, outcome: status });
  }

  // 2. The books must be covered by what the treasury really holds.
  const held = await chain.balances();
  const check = reconcile(state, held.quote, held.coin, held.self);
  if (!check.ok) throw new BooksMismatchError(check);
  if (held.sol < limits.minSol) throw new LowSolError(held.sol, limits.minSol);

  state = { ...state, cycle: state.cycle + 1 };
  store.save(state);
  report.cycle = state.cycle;

  const run = async (kind: PendingKind, build: () => Promise<Built>, extra?: Pick<Pending, "items" | "amount">) => {
    const result = await execute(deps, state, kind, build, extra);
    state = result.state;
    if (result.signature) report.signatures.push({ kind, signature: result.signature, outcome: result.outcome });
    if (result.outcome !== "confirmed") {
      report.notes.push(`${kind} ${result.outcome}${result.error ? `: ${result.error}` : ""}`);
    }
    return result;
  };

  // 3. Claim.
  const fees = await chain.pendingFees();
  if (fees > 0n && fees >= limits.minClaim) {
    await run("claim", () => chain.buildClaim());
  } else {
    report.notes.push(fees === 0n ? "no fees to claim" : "fees below MIN_CLAIM_TTWO, left for later");
  }

  // 4. For each target coin: burn anything bought earlier but not yet burned,
  //    then swap (up to the cap) and burn what arrived.
  const burnAll = async (target: Target) => {
    const amount = BigInt(target === "burn" ? state.coinToBurn : state.selfToBurn);
    if (amount > 0n) await run(BURN_KIND[target], () => chain.buildBurn(amount, target), { amount: amount.toString() });
  };
  for (const target of ["burn", "self"] as const) {
    await burnAll(target);
    const pool = BigInt(target === "burn" ? state.burnPool : state.buybackPool);
    const swapAmount = min(pool, limits.maxSwapPerCycle);
    if (swapAmount > 0n && swapAmount >= limits.minSwap) {
      const swap = await run(SWAP_KIND[target], () => chain.buildSwap(swapAmount, target), { amount: swapAmount.toString() });
      if (swap.outcome === "confirmed") await burnAll(target);
    }
  }

  // 5. Pay holders.
  if (state.payoutQueue.length === 0) {
    const pool = BigInt(state.payoutPool);
    if (pool > 0n && pool >= limits.minDistribute) {
      const snapshot = await chain.snapshotHolders();
      const holders = eligibleHolders(snapshot.balances, limits.minHold, snapshot.excluded);
      const { payouts } = allocate(pool, holders, limits.minPayout);
      if (payouts.length > 0) {
        state = startPayout(state, payouts);
        store.save(state);
        ledger.append({
          type: "distribution", cycle: state.cycle, pool: pool.toString(),
          holdersSeen: snapshot.balances.size, qualifying: holders.length, recipients: payouts.length,
          allotted: sum(payouts.map((p) => p.amount)).toString(), source: snapshot.source,
        });
      } else {
        report.notes.push("no holder qualifies for a payout yet; the pool carries over");
      }
    }
  }

  const skip = (items: QueueItem[], reason: string) => {
    state = returnToPool(state, items);
    store.save(state);
    for (const item of items) {
      ledger.append({ type: "payout_skipped", cycle: state.cycle, owner: item.owner, amount: item.amount, reason });
      report.skipped.push({ ...item, reason });
    }
  };

  let failures = 0;
  while (state.payoutQueue.length > 0 && failures < 3) {
    const batch = state.payoutQueue.slice(0, limits.payoutsPerTx);
    const result = await run("payout", () => chain.buildPayout(batch), { items: batch });
    if (result.outcome === "confirmed") {
      report.recipients += batch.length;
    } else if (result.outcome === "sim_failed") {
      if (batch.length === 1) {
        skip(batch, result.error ?? "simulation failed");
        continue;
      }
      // One bad recipient must not block the rest: try each on its own.
      for (const item of batch) {
        const single = await run("payout", () => chain.buildPayout([item]), { items: [item] });
        if (single.outcome === "confirmed") report.recipients += 1;
        else if (single.outcome === "sim_failed") skip([item], single.error ?? "simulation failed");
        else failures += 1;
      }
    } else {
      failures += 1;
    }
  }
  if (state.payoutQueue.length > 0) {
    report.notes.push(`${state.payoutQueue.length} payouts still queued; they are retried next cycle`);
  }

  report.claimed = BigInt(state.totals.claimed) - BigInt(before.claimed);
  report.swapped = BigInt(state.totals.swapped) - BigInt(before.swapped);
  report.burned = BigInt(state.totals.burned) - BigInt(before.burned);
  report.boughtBack = BigInt(state.totals.boughtBack) - BigInt(before.boughtBack);
  report.selfBurned = BigInt(state.totals.selfBurned) - BigInt(before.selfBurned);
  report.paid = BigInt(state.totals.paid) - BigInt(before.paid);
  report.state = state;
  return report;
}

export interface Check {
  result: "pass" | "fail" | "not_tested";
  detail: string;
}

/** What a dry run found out about one swap target. */
export interface SwapPreview {
  /** TTWO that would be swapped this cycle (pool plus this claim's share, capped). */
  amount: bigint;
  /** Coin the swap would deliver, when the simulation covered the full amount. */
  expectedOut: bigint | null;
  route: Check;
  swap: Check;
}

export interface DryReport {
  mode: "dry";
  state: State;
  pendingStatus: TxStatus | null;
  held: Holdings;
  reconciliation: Reconciliation;
  lowSol: boolean;
  fees: bigint;
  claim: Check;
  wouldSplit: { burn: bigint; buyback: bigint; payout: bigint };
  burn: SwapPreview;
  buyback: SwapPreview;
  snapshot: Check;
  holdersSeen: number;
  qualifying: number;
  wouldPay: { owner: string; amount: bigint }[];
  payoutPool: bigint;
  payout: Check;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function previewSwap(deps: Deps, target: Target, pool: bigint, heldQuote: bigint): Promise<SwapPreview> {
  const { chain, limits } = deps;
  const amount = min(pool, limits.maxSwapPerCycle);
  let route: Check;
  try {
    route = { result: "pass", detail: await chain.describeRoute(target) };
  } catch (error) {
    route = { result: "fail", detail: message(error) };
  }
  // A swap can only be simulated with TTWO the treasury already holds.
  let swap: Check = { result: "not_tested", detail: "the treasury holds no TTWO yet, so a swap cannot be simulated" };
  let expectedOut: bigint | null = null;
  const probe = min(amount > 0n ? amount : heldQuote, heldQuote);
  if (route.result === "fail") {
    swap = { result: "fail", detail: "no route" };
  } else if (probe > 0n) {
    try {
      const built = await chain.buildSwap(probe, target);
      const sim = await chain.simulate(built);
      if (sim.ok) {
        if (probe === amount) expectedOut = built.expectedOut;
        swap = { result: "pass", detail: `swapping ${probe} base units of TTWO would buy about ${built.expectedOut} base units` };
      } else {
        swap = { result: "fail", detail: sim.error ?? "simulation failed" };
      }
    } catch (error) {
      swap = { result: "fail", detail: message(error) };
    }
  }
  return { amount, expectedOut, route, swap };
}

/** Reads and simulates only. Sends nothing and writes nothing. */
export async function runDryCycle(deps: Deps, probeWallet: string): Promise<DryReport> {
  const { chain, store, limits } = deps;
  const state = store.load(chain.mints());
  const pendingStatus = state.pending
    ? await chain.status(state.pending.signature, state.pending.lastValidBlockHeight)
    : null;
  const held = await chain.balances();
  const reconciliation = reconcile(state, held.quote, held.coin, held.self);
  const fees = await chain.pendingFees();

  let claim: Check = { result: "not_tested", detail: "there are no fees to claim yet" };
  if (fees > 0n) {
    try {
      const sim = await chain.simulate(await chain.buildClaim());
      claim = sim.ok ? { result: "pass", detail: "claim simulated successfully" } : { result: "fail", detail: sim.error ?? "simulation failed" };
    } catch (error) {
      claim = { result: "fail", detail: message(error) };
    }
  }

  const wouldSplit = splitClaim(fees, limits.split);
  const payoutPool = BigInt(state.payoutPool) + wouldSplit.payout;
  const burn = await previewSwap(deps, "burn", BigInt(state.burnPool) + wouldSplit.burn, held.quote);
  const buyback = await previewSwap(deps, "self", BigInt(state.buybackPool) + wouldSplit.buyback, held.quote);

  let snapshot: Check;
  let holdersSeen = 0;
  let qualifying = 0;
  let wouldPay: { owner: string; amount: bigint }[] = [];
  let firstQualifying: string | null = null;
  try {
    const snap = await chain.snapshotHolders();
    const holders = eligibleHolders(snap.balances, limits.minHold, snap.excluded);
    holdersSeen = snap.balances.size;
    qualifying = holders.length;
    firstQualifying = holders[0]?.owner ?? null;
    wouldPay = payoutPool >= limits.minDistribute ? allocate(payoutPool, holders, limits.minPayout).payouts : [];
    snapshot = { result: "pass", detail: `${holdersSeen} holders found via ${snap.source}, ${qualifying} qualify` };
  } catch (error) {
    snapshot = { result: "fail", detail: message(error) };
  }

  // Payout test: the real first batch when the money is there, else 1 base unit.
  let payout: Check = { result: "not_tested", detail: "the treasury holds no TTWO and there are no fees to claim, so a transfer cannot be simulated" };
  const batch: QueueItem[] = wouldPay.slice(0, limits.payoutsPerTx).map((p) => ({ owner: p.owner, amount: p.amount.toString() }));
  const batchTotal = sum(batch.map((b) => BigInt(b.amount)));
  const tiny: QueueItem[] = [{ owner: firstQualifying ?? probeWallet, amount: "1" }];
  const attempts: { items: QueueItem[]; withClaim: boolean }[] = [];
  if (batch.length > 0 && held.quote >= batchTotal) attempts.push({ items: batch, withClaim: false });
  if (held.quote > 0n) attempts.push({ items: tiny, withClaim: false });
  else if (fees > 1n) attempts.push({ items: tiny, withClaim: true });
  const attempt = attempts[0];
  if (attempt) {
    const label = `${attempt.items.length} transfer(s) to ${attempt.items.map((i) => i.owner).join(", ")}` + (attempt.withClaim ? " (simulated together with the claim)" : "");
    try {
      const sim = await chain.simulate(await chain.buildPayout(attempt.items, { withClaim: attempt.withClaim }));
      payout = sim.ok ? { result: "pass", detail: `${label} simulated successfully` } : { result: "fail", detail: `${label}: ${sim.error ?? "simulation failed"}` };
    } catch (error) {
      payout = { result: "fail", detail: `${label}: ${message(error)}` };
    }
  }

  return {
    mode: "dry", state, pendingStatus, held, reconciliation, lowSol: held.sol < limits.minSol, fees, claim, wouldSplit,
    burn, buyback, snapshot, holdersSeen, qualifying, wouldPay, payoutPool, payout,
  };
}
