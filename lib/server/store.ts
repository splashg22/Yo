/** The server's small database: one JSON file. Amounts are kept as decimal strings, never as floating-point numbers. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { settings } from "./env";

export interface RingEvent {
  id: string;
  at: number;
  kind: "register" | "deposit" | "transfer" | "withdraw" | "otc";
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
}
export interface PendingLaunch {
  wallet: string;
  name: string;
  symbol: string;
  at: number;
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
  balances: Record<string, Record<string, string>>;
  events: RingEvent[];
  /** Transaction signatures already credited to the Ring ledger, or being credited right now. */
  credited: string[];
  nonces: string[];
  coins: Coin[];
  pendingLaunches: Record<string, PendingLaunch>;
  pendingPayouts: PendingPayout[];
  prices: Record<string, PricePoint[]>;
  offers: Offer[];
  lookupTable?: string;
}
const empty = (): State => ({
  registered: [],
  balances: {},
  events: [],
  credited: [],
  nonces: [],
  coins: [],
  pendingLaunches: {},
  pendingPayouts: [],
  prices: {},
  offers: [],
});

const open = new Map<string, State>();
const file = (): string => join(settings().dataDir, "state.json");

export function state(): State {
  const path = file();
  let current = open.get(path);
  if (!current) {
    current = existsSync(path) ? { ...empty(), ...(JSON.parse(readFileSync(path, "utf8")) as Partial<State>) } : empty();
    open.set(path, current);
  }
  return current;
}

/** Writes the whole state. A crash leaves either the old file or the new one, never half of each. */
export function save(): void {
  const path = file();
  mkdirSync(settings().dataDir, { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(state()));
  renameSync(`${path}.tmp`, path);
}

/** Tests only: drop what is in memory so the next read comes from disk. */
export function forget(): void {
  open.clear();
}
