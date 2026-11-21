/**
 * The server's state: one document, held in memory and written whole after each change.
 * It is kept in a JSON file by default, or in Postgres when DATABASE_URL is set (see database.ts).
 * Amounts are kept as decimal strings, never as floating-point numbers.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { join } from "node:path";
import { Database } from "./database";
import { settings } from "./env";

export interface RingEvent {
  id: string;
  at: number;
  kind: "register" | "deposit" | "transfer" | "withdraw" | "otc" | "window";
  /** What an explorer would show. */
  public: Record<string, string>;
  /** What only the parties can read. */
  sealed: Record<string, string>;
  /** Who may read the sealed part. */
  parties: string[];
  signature?: string;
  /** A withdrawal whose payout is not yet known to have landed. */
  pending?: boolean;
}
export interface Coin {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  createdAt: number;
  signature: string;
  /** Where the coin's picture can be fetched. Absent for a coin launched without one. */
  image?: string;
}
/** A sealed launch window: see windows.ts. Amounts are lamports, as decimal strings. */
export interface SealedWindow {
  id: string;
  creator: string;
  name: string;
  symbol: string;
  description: string;
  openedAt: number;
  closesAt: number;
  /** "launching": a launch transaction has been handed out and may still land; the window is locked. */
  status: "open" | "launching" | "launched" | "cancelled";
  commitments: Record<string, string>;
  /**
   * `building`: the lock was taken and the transaction is still being made; nothing has been handed out.
   * `escrowSignature`: the signature escrow put on the launch transaction. It is how the launch is recognised when it lands.
   */
  launching?: { mint: string; lastValidBlockHeight: number; building?: boolean; escrowSignature?: string };
  mint?: string;
  signature?: string;
}
export interface PendingLaunch {
  wallet: string;
  name: string;
  symbol: string;
  at: number;
  image?: string;
}
export interface PendingPayout {
  eventId: string;
  signature: string;
  lastValidBlockHeight: number;
}
export interface Offer {
  id: string;
  seller: string;
  buyer: string;
  mint: string;
  amount: string;
  priceLamports: string;
  createdAt: number;
  expiresAt: number;
  status: "open" | "settled" | "cancelled";
}
export interface PricePoint {
  at: number;
  /** Millionths of a lamport for one whole coin, as a decimal string. */
  microLamportsPerCoin: string;
}
export interface State {
  registered: string[];
  /** Each wallet's public note key, published when it registers. Public by nature. */
  noteKeys: Record<string, string>;
  balances: Record<string, Record<string, string>>;
  events: RingEvent[];
  /** Transaction signatures already credited to the Ring ledger, or being credited right now. */
  credited: string[];
  nonces: string[];
  coins: Coin[];
  pendingLaunches: Record<string, PendingLaunch>;
  /** Sealed launch windows. Empty unless the feature is switched on. */
  windows: SealedWindow[];
  pendingPayouts: PendingPayout[];
  prices: Record<string, PricePoint[]>;
  offers: Offer[];
  lookupTable?: string;
}
const empty = (): State => ({
  registered: [],
  noteKeys: {},
  balances: {},
  events: [],
  credited: [],
  nonces: [],
  coins: [],
  pendingLaunches: {},
  windows: [],
  pendingPayouts: [],
  prices: {},
  offers: [],
});

const open = new Map<string, State>();
const file = (): string => join(settings().dataDir, "state.json");

/** Postgres, when DATABASE_URL is set. One connection per database and schema, opened by `ready()`. */
let database: { key: string; opened: Promise<Database> } | undefined;
let closing: Promise<void> = Promise.resolve();
const databaseKey = (): string | null => {
  const { databaseUrl, databaseSchema } = settings();
  return databaseUrl ? `${databaseUrl}#${databaseSchema}` : null;
};

/**
 * Must be awaited before the state is first used. With a file there is nothing to wait for.
 * With Postgres this connects, takes the single-writer lock and reads the stored state into memory.
 */
export async function ready(): Promise<void> {
  const key = databaseKey();
  if (key === null) return;
  if (database?.key !== key) {
    const { databaseUrl, databaseSchema } = settings();
    const opened = closing.then(async () => {
      const { database: connected, stored } = await Database.open(databaseUrl, databaseSchema);
      open.set(key, { ...empty(), ...check(stored ?? {}, "the stored state in the database") });
      return connected;
    });
    database = { key, opened };
    // A failed start is not remembered: the next request tries again rather than serving nothing for ever.
    opened.catch(() => {
      if (database?.opened === opened) database = undefined;
    });
  }
  const connected = await database.opened;
  if (connected.broken) throw connected.broken;
}

export function state(): State {
  const key = databaseKey();
  if (key !== null) {
    const current = open.get(key);
    if (!current) throw new Error("the database has not been read yet");
    return current;
  }
  const path = file();
  let current = open.get(path);
  if (!current) {
    current = existsSync(path) ? { ...empty(), ...read(path) } : empty();
    open.set(path, current);
  }
  return current;
}

/** A stored state that cannot be read stops the server. Starting again from empty would silently erase every balance. */
function check(parsed: unknown, what: string): Partial<State> {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${what} is damaged (not an object). It was left untouched.`);
  return parsed;
}
function read(path: string): Partial<State> {
  try {
    return check(JSON.parse(readFileSync(path, "utf8")), `the state file ${path}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      reason.includes("is damaged")
        ? `${reason} Restore it or move it aside.`
        : `the state file ${path} is damaged (${reason}). It was left untouched. Restore it or move it aside.`,
    );
  }
}

/**
 * Records the state as it is now. With a file it is on disk when this returns: a crash leaves either
 * the old file or the new one, never half of each. With Postgres the write is queued, and `durable()`
 * waits for it.
 */
export function save(): void {
  const key = databaseKey();
  if (key !== null) {
    // The connection exists whenever there is state to save; the snapshot is taken now, so later changes are not mixed in.
    const snapshot = JSON.stringify(state());
    void database?.opened.then((connected) => connected.queue(snapshot));
    return;
  }
  const path = file();
  mkdirSync(settings().dataDir, { recursive: true });
  // Written, forced to disk, then renamed over the old file: after a power cut there is one whole file, old or new.
  const handle = openSync(`${path}.tmp`, "w");
  try {
    writeSync(handle, JSON.stringify(state()));
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(`${path}.tmp`, path);
}

/**
 * Resolves once every saved change is safely stored. Awaited before anything that cannot be undone
 * (a payout) and before any answer is given, so nothing is ever acted on or reported that a crash could lose.
 */
export async function durable(): Promise<void> {
  if (databaseKey() === null || !database) return;
  await (await database.opened).flushed();
}

/** What is really in the store right now, as text. For tests that check what was written. */
export async function storedText(): Promise<string> {
  if (databaseKey() === null) return existsSync(file()) ? readFileSync(file(), "utf8") : "";
  await ready();
  return (await database!.opened).storedText();
}

/** Tests only: drop what is in memory, and let go of the database, so the next use starts from what is stored. */
export function forget(): void {
  open.clear();
  if (database) {
    const previous = database.opened;
    closing = closing.then(() => previous.then((connected) => connected.close())).catch(() => undefined);
    database = undefined;
  }
}
