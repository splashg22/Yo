/**
 * Sends signed transactions and follows them to the end, without making anyone wait.
 *
 * - `submit` hands the transaction to the network and returns its signature at once.
 * - It goes down every configured route in parallel, and is sent again every few hundred milliseconds
 *   until the chain confirms it or its blockhash has expired.
 * - The outcome (confirmed, failed or expired) is told to whoever is listening, and kept for a few
 *   minutes for anyone who asks later.
 * - Only transactions this server built are accepted (see `builtHere`): it is not a relay.
 */
import { Connection, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { Settlement } from "../contract";
import { forgetBalances } from "./balances";
import { settings } from "./env";
import { failure, log } from "./log";
import { connection, explain } from "./solana";
import { builtHere } from "./transactions";

export type TxState = "sent" | "confirmed" | "failed" | "expired";
export interface TxOutcome {
  signature: string;
  state: TxState;
  /** The wallet that paid for it. */
  payer: string;
  kind: string;
  slot?: number;
  /** One plain sentence, when it failed or expired. */
  problem?: string;
  /** What this site recorded because of it, once confirmed. */
  settlement?: Settlement;
  /** Milliseconds from being handed in to being confirmed. */
  landedInMs?: number;
}
interface Tracked extends TxOutcome {
  raw: Buffer;
  lastValidBlockHeight: number;
  submittedAt: number;
  lastSentAt: number;
  sends: number;
  finishing: boolean;
  waiters: ((outcome: TxOutcome) => void)[];
}

const CHECK_MS = 300;
const RESEND_MS = 900;
const KEPT_MS = 300_000;
const tracked = new Map<string, Tracked>();
let timer: ReturnType<typeof setTimeout> | undefined;
let checking = false;
const listeners = new Set<(outcome: TxOutcome) => void>();
/** What runs once a transaction is confirmed, before anyone is told: crediting, listing, waiting for the indexer. Set by the server. */
let afterConfirmed: (signature: string, slot: number) => Promise<Settlement> = () => Promise.resolve({ credited: [], listed: [] });
export function onConfirmed(run: typeof afterConfirmed): void {
  afterConfirmed = run;
}
export function onOutcome(listener: (outcome: TxOutcome) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const sending = (): number => [...tracked.values()].filter((entry) => entry.state === "sent").length;

let routes: { key: string; connections: Connection[] } | undefined;
/** The main RPC first, then any extra routes. Each keeps its own warm connection. */
function everyRoute(): Connection[] {
  const { rpcUrl, sendUrls } = settings();
  const key = [rpcUrl, ...sendUrls].join(",");
  if (routes?.key !== key)
    routes = { key, connections: [connection(), ...sendUrls.map((url) => new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true }))] };
  return routes.connections;
}
const publicView = (entry: Tracked): TxOutcome => ({
  signature: entry.signature,
  state: entry.state,
  payer: entry.payer,
  kind: entry.kind,
  ...(entry.slot === undefined ? {} : { slot: entry.slot }),
  ...(entry.problem === undefined ? {} : { problem: entry.problem }),
  ...(entry.settlement === undefined ? {} : { settlement: entry.settlement }),
  ...(entry.landedInMs === undefined ? {} : { landedInMs: entry.landedInMs }),
});

function broadcast(entry: Tracked, preflight: boolean): Promise<string>[] {
  entry.lastSentAt = Date.now();
  entry.sends += 1;
  return everyRoute().map((route, index) =>
    // Only the main route simulates first, and only when asked: the others are extra chances to land, not extra opinions.
    route.sendRawTransaction(entry.raw, { skipPreflight: !(preflight && index === 0), maxRetries: 0, preflightCommitment: "confirmed" }),
  );
}

/**
 * Hands a signed transaction to the network. Returns as soon as one route has taken it.
 * `fast`: skip the simulation the RPC would run first. A trade that would fail then lands as a failed
 * transaction and costs its fee, which is the price of not waiting; the terminal uses it, nothing else does.
 */
export async function submit(base64: string, options: { fast?: boolean } = {}): Promise<TxOutcome> {
  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  } catch {
    throw new Error("that is not a signed transaction");
  }
  const known = builtHere(transaction);
  if (!known) throw new Error("this server did not build that transaction, or it has expired. Build it again and sign the new one.");
  const first = transaction.signatures[0];
  if (!first || first.every((byte) => byte === 0)) throw new Error("that transaction has not been signed");
  const signature = bs58.encode(first);
  const existing = tracked.get(signature);
  if (existing) return publicView(existing);
  const entry: Tracked = {
    signature,
    state: "sent",
    payer: transaction.message.staticAccountKeys[0]!.toBase58(),
    kind: known.kind,
    raw: Buffer.from(transaction.serialize()),
    lastValidBlockHeight: known.lastValidBlockHeight,
    submittedAt: Date.now(),
    lastSentAt: 0,
    sends: 0,
    finishing: false,
    waiters: [],
  };
  const attempts = broadcast(entry, options.fast !== true);
  try {
    if (options.fast === true) await Promise.any(attempts);
    else {
      // The main route's answer decides: its simulation says at once if the transaction cannot work, and then nothing was sent.
      await attempts[0];
    }
  } catch (error) {
    const cause = error instanceof AggregateError ? (error.errors[0] as unknown) : error;
    for (const attempt of attempts) attempt.catch(() => undefined);
    throw cause;
  }
  for (const attempt of attempts) attempt.catch(() => undefined);
  tracked.set(signature, entry);
  // Hear of it from the chain the moment it is confirmed, rather than at the next check.
  try {
    connection().onSignature(signature, () => void check(), "confirmed");
  } catch {
    /* the subscription is a shortcut; the timer still checks */
  }
  schedule();
  return publicView(entry);
}

function schedule(): void {
  timer ??= setTimeout(() => {
    timer = undefined;
    void check();
  }, CHECK_MS);
}

async function check(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const now = Date.now();
    for (const [signature, entry] of tracked) if (entry.state !== "sent" && now - entry.submittedAt > KEPT_MS) tracked.delete(signature);
    const pending = [...tracked.values()].filter((entry) => entry.state === "sent" && !entry.finishing);
    if (pending.length === 0) return;
    const chain = connection();
    // Two calls however many transactions are in flight: the height first, so "not found" after it means expired.
    const height = await chain.getBlockHeight("confirmed");
    for (let start = 0; start < pending.length; start += 256) {
      const batch = pending.slice(start, start + 256);
      const statuses = (await chain.getSignatureStatuses(batch.map((entry) => entry.signature))).value;
      batch.forEach((entry, index) => {
        const status = statuses[index];
        if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized" || status.err)) {
          if (status.err) finish(entry, "failed", status.slot, `the transaction failed on-chain: ${JSON.stringify(status.err)}`);
          else void confirmed(entry, status.slot);
        } else if (!status && height > entry.lastValidBlockHeight) {
          finish(entry, "expired", undefined, "the transaction expired before the chain took it. Nothing was spent. Try again.");
        } else if (now - entry.lastSentAt >= RESEND_MS) {
          for (const attempt of broadcast(entry, false)) attempt.catch(() => undefined);
        }
      });
    }
  } catch (error) {
    log("warn", "the sender could not check its transactions", failure(error));
  } finally {
    checking = false;
    if ([...tracked.values()].some((entry) => entry.state === "sent")) schedule();
  }
}

async function confirmed(entry: Tracked, slot: number): Promise<void> {
  entry.finishing = true;
  entry.slot = slot;
  entry.landedInMs = Date.now() - entry.submittedAt;
  try {
    entry.settlement = await afterConfirmed(entry.signature, slot);
  } catch (error) {
    // It landed; only this site's record of it is behind. The reconciler credits it later, so the person is told it landed.
    log("error", "a confirmed transaction could not be settled yet", { signature: entry.signature, ...failure(error) });
    entry.problem = `it is confirmed on-chain, but this site has not recorded it yet: ${explain(error)}`;
  }
  finish(entry, "confirmed", slot, entry.problem);
}

function finish(entry: Tracked, state: TxState, slot: number | undefined, problem: string | undefined): void {
  if (entry.state !== "sent") return;
  entry.state = state;
  if (slot !== undefined) entry.slot = slot;
  if (problem !== undefined) entry.problem = problem;
  entry.raw = Buffer.alloc(0);
  forgetBalances(entry.payer);
  const outcome = publicView(entry);
  log("info", "transaction", { signature: entry.signature, kind: entry.kind, state, sends: entry.sends, ms: Date.now() - entry.submittedAt });
  for (const waiter of entry.waiters.splice(0)) waiter(outcome);
  for (const listener of listeners) listener(outcome);
}

/** What is known of a transaction handed to `submit`. */
export const outcomeOf = (signature: string): TxOutcome | undefined => {
  const entry = tracked.get(signature);
  return entry ? publicView(entry) : undefined;
};
/** Waits up to `ms` for a transaction to finish. Resolves with where it stands if it has not. */
export function settled(signature: string, ms: number): Promise<TxOutcome | undefined> {
  const entry = tracked.get(signature);
  if (!entry || entry.state !== "sent") return Promise.resolve(entry ? publicView(entry) : undefined);
  return new Promise((resolve) => {
    const give = (outcome: TxOutcome): void => {
      clearTimeout(limit);
      resolve(outcome);
    };
    const limit = setTimeout(() => {
      entry.waiters = entry.waiters.filter((waiter) => waiter !== give);
      resolve(publicView(entry));
    }, ms);
    entry.waiters.push(give);
  });
}
/** Tests only. */
export function forgetSender(): void {
  tracked.clear();
  routes = undefined;
}
