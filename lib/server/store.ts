/**
 * The site's own records and the stand-in Ring ledger.
 *
 * They are held in memory by the one server process that owns the database, and every change is written
 * to the database as one transaction, into real tables (see db/schema.ts): a row per balance, a row per
 * credited signature, a row per event, offer, window and payout. Only the rows a step changed are written.
 *
 * - `save()` takes what changed since the last save and queues it as one transaction.
 * - `durable()` waits until everything queued has committed. No answer is given, and nothing that cannot
 *   be undone is done, before that.
 * - The database is a second line of defence, not a copy: it refuses a negative balance and a signature
 *   credited twice. If it refuses a write, or finds its version changed behind the server's back, the
 *   store stops accepting anything until the server is restarted and has read what is really stored.
 *
 * Amounts are kept as decimal strings, never as floating-point numbers.
 */
import { openDb, type Db, type Sql } from "./db";
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

/** What a state looks like as rows: a table, a key and the row's content as text. */
type Rows = Map<string, string>;
const SEP = "\u0000";
/** Collections kept as one row per item in `records`, with the property that names an item. */
const LISTS = { events: "id", coins: "mint", windows: "id", pendingPayouts: "eventId", offers: "id" } as const;
const MAPS = ["noteKeys", "pendingLaunches", "prices"] as const;

function rowsOf(current: State): Rows {
  const rows: Rows = new Map();
  for (const [wallet, coins] of Object.entries(current.balances))
    for (const [mint, amount] of Object.entries(coins)) rows.set(`b${SEP}${wallet}${SEP}${mint}`, amount);
  for (const signature of current.credited) rows.set(`c${SEP}${signature}`, "");
  for (const entry of current.nonces) rows.set(`n${SEP}${entry}`, "");
  for (const wallet of current.registered) rows.set(`r${SEP}registered${SEP}${wallet}`, "true");
  for (const [name, key] of Object.entries(LISTS))
    for (const item of current[name as keyof typeof LISTS] as unknown as Record<string, unknown>[])
      rows.set(`r${SEP}${name}${SEP}${String(item[key])}`, JSON.stringify(item));
  for (const name of MAPS) for (const [key, value] of Object.entries(current[name])) rows.set(`r${SEP}${name}${SEP}${key}`, JSON.stringify(value));
  if (current.lookupTable !== undefined) rows.set(`r${SEP}settings${SEP}lookupTable`, JSON.stringify(current.lookupTable));
  return rows;
}

interface Stored {
  version: number;
  state: State;
  /** The highest place given to any record so far. */
  lastOrder: number;
}
async function readAll(sql: Sql): Promise<Stored> {
  const current = empty();
  const version = Number((await sql.query<{ value: string }>("select value from meta where key = 'version'"))[0]?.value ?? "0");
  for (const row of await sql.query<{ wallet: string; mint: string; amount: string }>("select wallet, mint, amount::text as amount from ring_balances"))
    (current.balances[row.wallet] ??= {})[row.mint] = row.amount;
  current.credited = (await sql.query<{ signature: string }>("select signature from credited order by seq")).map((row) => row.signature);
  current.nonces = (await sql.query<{ entry: string }>("select entry from nonces order by entry")).map((row) => row.entry);
  const lists = current as unknown as Record<string, unknown[]>;
  const maps = current as unknown as Record<string, Record<string, unknown>>;
  for (const row of await sql.query<{ collection: string; key: string; body: unknown }>("select collection, key, body from records order by collection, ord")) {
    if (row.collection === "registered") current.registered.push(row.key);
    else if (row.collection === "settings") {
      if (row.key === "lookupTable" && typeof row.body === "string") current.lookupTable = row.body;
    } else if (row.collection in LISTS) lists[row.collection]!.push(row.body);
    else if ((MAPS as readonly string[]).includes(row.collection)) maps[row.collection]![row.key] = row.body;
    else throw new Error(`the stored state is damaged (an unknown kind of record, "${row.collection}"). It was left untouched.`);
  }
  const lastOrder = Number((await sql.query<{ last: number | null }>("select max(ord) as last from records"))[0]?.last ?? 0);
  return { version, state: current, lastOrder };
}

/** Writes the difference between two sets of rows, and moves the version on, as part of the caller's transaction. */
async function writeDelta(sql: Sql, before: Rows, after: Rows, version: number, order: { last: number }): Promise<void> {
  const moved = await sql.query("update meta set value = $2 where key = 'version' and value = $1 returning value", [String(version), String(version + 1)]);
  if (moved.length !== 1) throw new Error("the stored state was changed by something else");
  const balances: { wallet: string; mint: string; amount: string }[] = [];
  const records: { collection: string; key: string; ord: number; body: string }[] = [];
  const credited: string[] = [];
  const nonces: string[] = [];
  const gone: Record<"b" | "c" | "n" | "r", string[][]> = { b: [], c: [], n: [], r: [] };
  for (const [key, value] of after) {
    if (before.get(key) === value) continue;
    const [table, first, second] = key.split(SEP) as [string, string, string];
    if (table === "b") balances.push({ wallet: first, mint: second, amount: value });
    else if (table === "c") credited.push(first);
    else if (table === "n") nonces.push(first);
    else {
      // A record keeps the place it was first given, so a list comes back in the order it was made.
      // An existing row keeps its place (the update below does not touch it); a new one goes to the end.
      records.push({ collection: first, key: second, ord: before.has(key) ? 0 : ++order.last, body: value });
    }
  }
  for (const key of before.keys()) {
    if (after.has(key)) continue;
    const [table, first, second] = key.split(SEP) as ["b" | "c" | "n" | "r", string, string];
    gone[table].push([first, second]);
  }
  if (balances.length)
    await sql.query(
      `insert into ring_balances (wallet, mint, amount) select wallet, mint, amount::numeric from jsonb_to_recordset($1::jsonb) as x(wallet text, mint text, amount text)
       on conflict (wallet, mint) do update set amount = excluded.amount`,
      [JSON.stringify(balances)],
    );
  // No "on conflict" here on purpose: a signature already credited makes the whole transaction fail.
  if (credited.length) await sql.query("insert into credited (signature) select jsonb_array_elements_text($1::jsonb)", [JSON.stringify(credited)]);
  if (nonces.length) await sql.query("insert into nonces (entry) select jsonb_array_elements_text($1::jsonb)", [JSON.stringify(nonces)]);
  if (records.length)
    await sql.query(
      `insert into records (collection, key, ord, body) select collection, key, ord, body::json from jsonb_to_recordset($1::jsonb) as x(collection text, key text, ord bigint, body text)
       on conflict (collection, key) do update set body = excluded.body`,
      [JSON.stringify(records)],
    );
  for (const [wallet, mint] of gone.b) await sql.query("delete from ring_balances where wallet = $1 and mint = $2", [wallet, mint]);
  if (gone.c.length)
    await sql.query("delete from credited where signature in (select jsonb_array_elements_text($1::jsonb))", [JSON.stringify(gone.c.map(([key]) => key))]);
  if (gone.n.length)
    await sql.query("delete from nonces where entry in (select jsonb_array_elements_text($1::jsonb))", [JSON.stringify(gone.n.map(([key]) => key))]);
  for (const [collection, key] of gone.r) await sql.query("delete from records where collection = $1 and key = $2", [collection, key]);
}

/** One opened store: the database, the state in memory, and what of it has been written. */
class Store {
  private written: Rows;
  private readonly order: { last: number };
  private tail: Promise<void> = Promise.resolve();
  failure: Error | undefined;

  private constructor(
    readonly db: Db,
    readonly current: State,
    private version: number,
    lastOrder: number,
  ) {
    this.written = rowsOf(current);
    this.order = { last: lastOrder };
  }

  static async open(): Promise<Store> {
    const db = await openDb(settings());
    try {
      const stored = await readAll(db);
      return new Store(db, stored.state, stored.version, stored.lastOrder);
    } catch (error) {
      await db.close().catch(() => undefined);
      throw error;
    }
  }

  /** Queues what changed since the last save as one transaction. The rows are taken now, so later changes are not mixed in. */
  save(): void {
    const after = rowsOf(this.current);
    const before = this.written;
    this.written = after;
    this.tail = this.tail.then(async () => {
      if (this.failure) return;
      try {
        const version = this.version;
        await this.db.tx((sql) => writeDelta(sql, before, after, version, this.order));
        this.version += 1;
      } catch (error) {
        this.failure = new Error(
          `the database did not accept a change (${error instanceof Error ? error.message : String(error)}). Nothing more is accepted until the server is restarted.`,
        );
      }
    });
  }
  async flushed(): Promise<void> {
    await this.tail;
    if (this.failure) throw this.failure;
  }
  async close(): Promise<void> {
    await this.tail;
    await this.db.close();
  }
}

let opened: { key: string; store: Promise<Store>; ready?: Store } | undefined;
let closing: Promise<void> = Promise.resolve();
/** Tests of pure logic run with no database at all: APP_STORE=memory. Never set it on a server. */
let memory: State | undefined;
const inMemory = (): boolean => process.env.APP_STORE === "memory";
const storeKey = (): string => {
  const { databaseUrl, databaseSchema, dataDir } = settings();
  return databaseUrl ? `${databaseUrl}#${databaseSchema}` : `embedded:${dataDir}`;
};

/** Must be awaited before the state is first used: it opens the database, takes the single-writer lock and reads what is stored. */
export async function ready(): Promise<void> {
  if (inMemory()) return;
  const key = storeKey();
  if (opened?.key !== key) {
    const store = closing.then(() => Store.open());
    const mine: NonNullable<typeof opened> = { key, store };
    opened = mine;
    store.then(
      (value) => (mine.ready = value),
      // A failed start is not remembered: the next request tries again rather than serving nothing for ever.
      () => {
        if (opened === mine) opened = undefined;
      },
    );
  }
  const store = await opened.store;
  if (store.failure) throw store.failure;
}

export function state(): State {
  if (inMemory()) return (memory ??= empty());
  if (opened?.key !== storeKey() || !opened.ready) throw new Error("the database has not been read yet");
  return opened.ready.current;
}

/** The open database, for the parts of the server that keep their own tables (the indexer). `ready()` first. */
export function database(): Db {
  if (opened?.key !== storeKey() || !opened.ready) throw new Error("the database has not been read yet");
  return opened.ready.db;
}

/** Records the state as it is now: what changed since the last save is queued as one transaction. `durable()` waits for it. */
export function save(): void {
  if (inMemory()) return;
  opened?.ready?.save();
}

/**
 * Resolves once every saved change has committed. Awaited before anything that cannot be undone
 * (a payout) and before any answer is given, so nothing is ever acted on or reported that a crash could lose.
 */
export async function durable(): Promise<void> {
  if (inMemory() || !opened) return;
  await (await opened.store).flushed();
}

/** What is really in the database right now, read back from its tables, as JSON text. For tests that check what was written. */
export async function storedText(): Promise<string> {
  await ready();
  await durable().catch(() => undefined);
  return JSON.stringify((await readAll(database())).state);
}

/** Whatever else holds the database (the indexer) registers here, to be stopped before the database is let go. */
const beforeClose = new Set<() => Promise<void>>();
export function onForget(stop: () => Promise<void>): void {
  beforeClose.add(stop);
}

/** Tests only: drop what is in memory, and let go of the database, so the next use starts from what is stored. */
export function forget(): void {
  memory = undefined;
  const stops = [...beforeClose];
  beforeClose.clear();
  if (stops.length > 0) closing = closing.then(() => Promise.all(stops.map((stop) => stop().catch(() => undefined)))).then(() => undefined);
  if (opened) {
    const previous = opened.store;
    closing = closing.then(() => previous.then((store) => store.close())).catch(() => undefined);
    opened = undefined;
  }
}
