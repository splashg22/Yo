/** The server's small database: one JSON file. Amounts are kept as decimal strings. */
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
}
export interface Coin {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  createdAt: number;
  signature: string;
  tokenProgram: string;
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
export interface State {
  registered: string[];
  balances: Record<string, Record<string, string>>;
  events: RingEvent[];
  credited: string[];
  nonces: string[];
  coins: Coin[];
  prices: Record<string, { at: number; lamportsPerMillion: number }[]>;
  offers: Offer[];
  lookupTable?: string;
  bootstrapped?: boolean;
}
const empty = (): State => ({ registered: [], balances: {}, events: [], credited: [], nonces: [], coins: [], prices: {}, offers: [] });

const open = new Map<string, State>();
const file = () => join(settings().dataDir, "state.json");

export function state(): State {
  const path = file();
  let current = open.get(path);
  if (!current) {
    current = existsSync(path) ? { ...empty(), ...(JSON.parse(readFileSync(path, "utf8")) as State) } : empty();
    open.set(path, current);
  }
  return current;
}
export function save(): void {
  const path = file();
  mkdirSync(settings().dataDir, { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(state()));
  renameSync(`${path}.tmp`, path);
}
/** Tests only. */
export function forget(): void {
  open.clear();
}
