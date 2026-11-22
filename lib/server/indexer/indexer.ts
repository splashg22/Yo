/**
 * The indexer: follows the chain block by block and keeps trades, candles, holders and each coin's curve.
 *
 * - In order: blocks are applied one after another, each as one database transaction.
 * - Never twice: a block's row is inserted in that transaction, and a trade's key is its transaction and place in it.
 * - Restarts: what was applied is in the database; the follower carries on from the last block there.
 * - Reorgs: a block whose parent is not the block applied before it means the chain changed its mind. Everything
 *   above the common ancestor is undone from the undo rows, candles are rebuilt from the trades left, and the new
 *   branch is applied.
 */
import type { Db, Sql } from "../db";
import { TIMEFRAMES, bucketOf, extend, priceOf, type Candle, type Market, type Timeframe, type Trade } from "./model";
import { toMillionths, tradeFrom, type PoolFacts } from "./meteora";
import type { ChainBlock, ChainSource, ChainTx, EarlyTx, TradeEvent } from "./types";

/** How many applied blocks are kept undoable. A confirmed block is practically never dropped; this is far deeper than any seen. */
export const UNDO_DEPTH = 300;
const CANDLES_KEPT = 600;
const RECENT_KEPT = 200;
const FETCH_AHEAD = 8;

export interface Applied {
  slot: number;
  /** Milliseconds, from the block. */
  at: number;
  trades: Trade[];
  /** Markets whose row changed, as they are now. */
  markets: Market[];
  created: Market[];
  candles: { mint: string; tf: Timeframe; candle: Candle }[];
  holders: { mint: string; owner: string; amount: bigint }[];
  signatures: string[];
}
export interface IndexerEvents {
  /** A block was applied. */
  applied?: (block: Applied) => void;
  /** A trade was heard of before its block was read. It is not stored; the block will confirm or drop it. */
  early?: (tx: EarlyTx, trades: Trade[]) => void;
  /** Blocks were undone. Anything shown from memory must be read again. */
  reorg?: (toSlot: number, mints: string[]) => void;
}
type Log = (level: "info" | "warn" | "error", message: string, fields?: Record<string, unknown>) => void;

interface MarketRow {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  uri: string;
  created_at: number;
  created_slot: number;
  supply: string;
  initial_real_tokens: string;
  virtual_sol: string;
  virtual_tokens: string;
  real_sol: string;
  real_tokens: string;
  complete: boolean;
  completed_at: number | null;
  last_trade_at: number | null;
  pool: string | null;
  holders: number;
  trades: number;
  seen_from: number | null;
  quote: string | null;
  venue: string | null;
  decimals: number | null;
}
const MARKET_COLUMNS =
  "mint, creator, name, symbol, uri, created_at, created_slot, supply::text, initial_real_tokens::text, virtual_sol::text, virtual_tokens::text, real_sol::text, real_tokens::text, complete, completed_at, last_trade_at, pool, holders, trades, seen_from, quote, venue, decimals";
const fromRow = (row: MarketRow): Market => ({
  mint: row.mint,
  creator: row.creator,
  name: row.name,
  symbol: row.symbol,
  uri: row.uri,
  createdAt: Number(row.created_at),
  createdSlot: Number(row.created_slot),
  supply: BigInt(row.supply),
  initialRealTokens: BigInt(row.initial_real_tokens),
  virtualSol: BigInt(row.virtual_sol),
  virtualTokens: BigInt(row.virtual_tokens),
  realSol: BigInt(row.real_sol),
  realTokens: BigInt(row.real_tokens),
  complete: row.complete,
  ...(row.completed_at === null ? {} : { completedAt: Number(row.completed_at) }),
  ...(row.last_trade_at === null ? {} : { lastTradeAt: Number(row.last_trade_at) }),
  ...(row.pool === null ? {} : { pool: row.pool }),
  holders: row.holders,
  trades: row.trades,
  ...(row.seen_from === null || row.seen_from === undefined ? {} : { seenFromSlot: Number(row.seen_from) }),
  ...(row.quote === null || row.quote === undefined ? {} : { quote: row.quote }),
  ...(row.venue === "damm2" ? { venue: "damm2" as const } : {}),
  ...(row.decimals === null || row.decimals === undefined ? {} : { decimals: row.decimals }),
});
const toRow = (market: Market): MarketRow => ({
  mint: market.mint,
  creator: market.creator,
  name: market.name,
  symbol: market.symbol,
  uri: market.uri,
  created_at: market.createdAt,
  created_slot: market.createdSlot,
  supply: market.supply.toString(),
  initial_real_tokens: market.initialRealTokens.toString(),
  virtual_sol: market.virtualSol.toString(),
  virtual_tokens: market.virtualTokens.toString(),
  real_sol: market.realSol.toString(),
  real_tokens: market.realTokens.toString(),
  complete: market.complete,
  completed_at: market.completedAt ?? null,
  last_trade_at: market.lastTradeAt ?? null,
  pool: market.pool ?? null,
  holders: market.holders,
  trades: market.trades,
  seen_from: market.seenFromSlot ?? null,
  quote: market.quote ?? null,
  venue: market.venue ?? null,
  decimals: market.decimals ?? null,
});
const MARKET_RECORD =
  "mint text, creator text, name text, symbol text, uri text, created_at bigint, created_slot bigint, supply numeric, initial_real_tokens numeric, virtual_sol numeric, virtual_tokens numeric, real_sol numeric, real_tokens numeric, complete boolean, completed_at bigint, last_trade_at bigint, pool text, holders int, trades int, seen_from bigint, quote text, venue text, decimals int";
const MARKET_NAMES = MARKET_RECORD.split(", ").map((column) => column.split(" ")[0]!);

interface TradeRow {
  signature: string;
  idx: number;
  mint: string;
  slot: number;
  tx_index: number;
  at: number;
  wallet: string;
  is_buy: boolean;
  venue: "curve" | "amm";
  sol: string;
  tokens: string;
  price: string;
}
const TRADE_COLUMNS = "signature, idx, mint, slot, tx_index, at, wallet, is_buy, venue, sol::text, tokens::text, price::text";
const tradeFromRow = (row: TradeRow): Trade => ({
  signature: row.signature,
  idx: row.idx,
  mint: row.mint,
  slot: Number(row.slot),
  txIndex: row.tx_index,
  at: Number(row.at),
  wallet: row.wallet,
  isBuy: row.is_buy,
  venue: row.venue,
  sol: BigInt(row.sol),
  tokens: BigInt(row.tokens),
  price: BigInt(row.price),
});
interface CandleRow {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  vol_sol: string;
  n: number;
  buys: number;
}
const candleFromRow = (row: CandleRow): Candle => ({
  t: Number(row.t),
  o: Number(row.o),
  h: Number(row.h),
  l: Number(row.l),
  c: Number(row.c),
  v: Number(row.vol_sol),
  n: row.n,
  b: row.buys,
});

/** What every pump.fun coin is made with: a thousand million coins, of which this many are sold on the curve. */
const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const PUMP_SUPPLY = 1_000_000_000_000_000n;
const PUMP_CURVE_TOKENS = 793_100_000_000_000n;
/**
 * A market for a coin first seen through a trade. What the trade says is taken as the coin's state; what it cannot
 * say (name, ticker, creator, when it was made, anything earlier) is left empty and marked by `seenFromSlot`.
 * A pool trade does not name its coin: it is the coin whose account, among those the transaction changed, the pool owns.
 */
function discovered(event: TradeEvent, tx: ChainTx, slot: number, at: number): Market | undefined {
  const pool = event.venue === "amm" ? event.mint.slice(5) : undefined;
  // A pool is followed only if it is seen to hold wrapped SOL: a pool priced in something else would be read at a wrong price.
  if (pool && !tx.balances.some((balance) => balance.owner === pool && balance.mint === WRAPPED_SOL)) return undefined;
  const mint = pool ? tx.balances.find((balance) => balance.owner === pool && balance.mint !== WRAPPED_SOL)?.mint : event.mint;
  if (!mint) return undefined;
  return {
    mint,
    creator: "",
    name: "",
    symbol: "",
    uri: "",
    createdAt: at,
    createdSlot: slot,
    supply: PUMP_SUPPLY,
    initialRealTokens: PUMP_CURVE_TOKENS,
    virtualSol: event.virtualSol,
    virtualTokens: event.virtualTokens,
    realSol: event.realSol,
    realTokens: event.realTokens,
    complete: pool !== undefined,
    ...(pool ? { pool, completedAt: at } : {}),
    holders: 0,
    trades: 0,
    seenFromSlot: slot,
  };
}

/**
 * A market for a coin first seen trading in a Meteora pool against SOL. It is not a pump.fun coin: it has no curve
 * and no graduation, and is written as "complete" so that nothing here waits for one.
 */
function fromPool(facts: PoolFacts, trade: TradeEvent, slot: number, at: number): Market {
  const supply = toMillionths(facts.supply, facts.decimals);
  return {
    mint: facts.mint,
    creator: "",
    name: "",
    symbol: "",
    uri: "",
    createdAt: at,
    createdSlot: slot,
    supply,
    initialRealTokens: 0n,
    virtualSol: trade.virtualSol,
    virtualTokens: trade.virtualTokens,
    realSol: trade.realSol,
    realTokens: trade.realTokens,
    complete: true,
    pool: facts.pool,
    holders: 0,
    trades: 0,
    seenFromSlot: slot,
    venue: "damm2",
    ...(facts.decimals === 6 ? {} : { decimals: facts.decimals }),
  };
}

/** How long the start waits for the indexer to be level with the chain before the server starts without it. */
const START_WAIT_MS = 5_000;

export class Indexer {
  readonly markets = new Map<string, Market>();
  private readonly pools = new Map<string, string>();
  private readonly candleCache = new Map<string, Promise<Candle[]>>();
  private readonly recentCache = new Map<string, Promise<Trade[]>>();
  /** The last block applied. */
  private tip: { slot: number; hash: string } | undefined;
  /** Every slot up to this one has been looked at. */
  cursor = -1;
  /** The newest confirmed slot the chain has reported. */
  head = -1;
  /** When the last block was applied, by this machine's clock. */
  lastAppliedAt = 0;
  private running = false;
  private wake: (() => void) | undefined;
  private stopWatching: (() => void) | undefined;
  private loop: Promise<void> | undefined;
  private waiters: { slot: number; resolve: () => void }[] = [];
  /** Trades heard of early whose block has not been applied yet, by signature. */
  private readonly early = new Map<string, number>();
  failure: string | undefined;

  /** Called when the first pass over the chain has ended, level or failed. */
  private firstPassDone: (() => void) | undefined;
  constructor(
    private readonly db: Db,
    private readonly source: ChainSource,
    private readonly events: IndexerEvents = {},
    private readonly log: Log = () => undefined,
    /** How long `start` waits to be level with the chain before it returns anyway. */
    private readonly startWaitMs = START_WAIT_MS,
    /**
     * Follow a coin from the first trade of it that is seen, not only from its creation. For a source that carries
     * every trade (a full stream, a recording). Off by default: a source that carries only chosen coins has no use for it.
     */
    private readonly discover = false,
  ) {}

  /** Whether Meteora's DAMM v2 pools are read. Off unless the settings ask for it (FEED_VENUES). */
  readMeteora = false;
  /** Pools of other programs whose coins are known: read from the chain once each (lib/server/pools.ts). */
  private readonly poolFacts = new Map<string, PoolFacts>();
  /** Pools seen trading whose coins are not known yet. Their swaps are not read until they are. */
  private readonly unreadPools = new Set<string>();
  /** Up to `most` pools waiting to be read. */
  poolsToRead(most: number, skip: (pool: string) => boolean): string[] {
    const found: string[] = [];
    for (const pool of this.unreadPools) {
      if (found.length >= most) break;
      if (!skip(pool)) found.push(pool);
    }
    return found;
  }
  /** Records what a pool trades, once it has been read from the chain. From the next block its swaps are read. */
  async learnPool(facts: PoolFacts): Promise<void> {
    await this.db.query(
      `insert into venue_pools (pool, venue, mint, coin_is_a, decimals, supply, quote) values ($1, 'damm2', $2, $3, $4, $5, $6) on conflict (pool) do nothing`,
      [facts.pool, facts.mint, facts.coinIsA, facts.decimals, facts.supply.toString(), facts.quote],
    );
    this.poolFacts.set(facts.pool, facts);
    this.unreadPools.delete(facts.pool);
  }
  /** A pool that turned out not to be readable: not asked about again. */
  forgetPool(pool: string): void {
    this.unreadPools.delete(pool);
  }
  factsOfPool(pool: string): PoolFacts | undefined {
    return this.poolFacts.get(pool);
  }

  /**
   * Reads what is stored, then follows the chain until `stop`. Resolves once it has caught up for the first time,
   * or at once if the chain cannot be reached, or after a few seconds if there is a lot to catch up on: the server
   * still starts, says on /health how far behind it is, and the pages say their figures are old until it is level.
   */
  async start(): Promise<void> {
    await this.load();
    this.running = true;
    this.stopWatching = this.source.watch(
      () => this.wake?.(),
      (tx) => this.heard(tx),
    );
    const firstPass = new Promise<void>((resolve) => (this.firstPassDone = resolve));
    // One loop does all the catching up, from the first block to the last: nothing else applies blocks.
    this.loop = this.follow();
    let waiting: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([firstPass, new Promise<void>((resolve) => (waiting = setTimeout(resolve, this.startWaitMs)))]);
    clearTimeout(waiting);
    if (this.failure !== undefined) this.log("error", "the indexer could not read the chain at the start; it will keep trying", { error: this.failure });
    else if (this.head - this.cursor > 5)
      this.log("warn", "the indexer is still catching up; the server starts without waiting for it", { behindSlots: this.head - this.cursor });
  }
  async stop(): Promise<void> {
    this.running = false;
    this.stopWatching?.();
    this.wake?.();
    await this.loop;
  }

  private async load(): Promise<void> {
    this.markets.clear();
    this.pools.clear();
    this.candleCache.clear();
    this.recentCache.clear();
    for (const row of await this.db.query<MarketRow>(`select ${MARKET_COLUMNS} from markets`)) {
      const market = fromRow(row);
      this.markets.set(market.mint, market);
      if (market.pool) this.pools.set(market.pool, market.mint);
    }
    this.poolFacts.clear();
    for (const row of await this.db.query<{ pool: string; mint: string; coin_is_a: boolean; decimals: number; supply: string; quote: string }>(
      "select pool, mint, coin_is_a, decimals, supply::text, quote from venue_pools",
    ))
      this.poolFacts.set(row.pool, {
        pool: row.pool,
        mint: row.mint,
        coinIsA: row.coin_is_a,
        decimals: row.decimals,
        supply: BigInt(row.supply),
        quote: row.quote,
      });
    const last = (await this.db.query<{ slot: number; hash: string }>("select slot, hash from blocks order by slot desc limit 1"))[0];
    this.tip = last ? { slot: Number(last.slot), hash: last.hash } : undefined;
    const stored = (await this.db.query<{ value: string }>("select value from meta where key = 'cursor'"))[0];
    this.cursor = stored ? Number(stored.value) : -1;
  }

  private async follow(): Promise<void> {
    while (this.running) {
      try {
        await this.catchUp();
        this.failure = undefined;
        this.firstPassDone?.();
      } catch (error) {
        this.failure = error instanceof Error ? error.message : String(error);
        this.firstPassDone?.();
        this.log("error", "the indexer could not read the chain", { error: this.failure });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      // Woken by the chain's own slot notification; the timer is the fallback if the subscription has gone quiet.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 400);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }

  /** Applies every confirmed block after the cursor, in order. */
  private async catchUp(): Promise<void> {
    for (;;) {
      this.head = Math.max(this.head, await this.source.head());
      this.failure = undefined;
      if (this.cursor < 0) {
        // A new database starts at the present. Coins made before now are added one at a time, when someone asks for them.
        this.cursor = this.head;
        await this.db.tx((sql) =>
          sql.query("insert into meta (key, value) values ('cursor', $1) on conflict (key) do update set value = excluded.value", [String(this.cursor)]),
        );
      }
      if (this.cursor >= this.head) break;
      // A stream's slots are real slot numbers with long empty stretches between its blocks, and asking it for a range is free.
      const stream = this.source.kind === "stream";
      const to = stream ? this.head : Math.min(this.head, this.cursor + 200);
      const slots = (await this.source.slots(this.cursor + 1, to)).filter((slot) => slot > this.cursor);
      for (let start = 0; start < slots.length; start += FETCH_AHEAD) {
        const blocks = await Promise.all(slots.slice(start, start + FETCH_AHEAD).map((slot) => this.source.block(slot)));
        for (const block of blocks) {
          if (!block || block.slot <= this.cursor) continue;
          if (!stream && this.tip && block.parentHash !== this.tip.hash) await this.reorganise(block);
          await this.apply(block);
        }
      }
      if (this.cursor < to) this.moveCursor(to);
    }
  }
  private moveCursor(slot: number): void {
    this.cursor = slot;
    this.settleWaiters();
  }
  private settleWaiters(): void {
    const ready = this.waiters.filter((waiter) => waiter.slot <= this.cursor);
    this.waiters = this.waiters.filter((waiter) => waiter.slot > this.cursor);
    for (const waiter of ready) waiter.resolve();
    // An early trade whose slot has been passed without its block carrying it will not arrive: forget it.
    for (const [signature, slot] of this.early) if (slot + 32 < this.cursor) this.early.delete(signature);
  }
  /** Resolves once every block up to `slot` has been applied. */
  reached(slot: number): Promise<void> {
    if (slot <= this.cursor) return Promise.resolve();
    this.wake?.();
    return new Promise((resolve) => this.waiters.push({ slot, resolve }));
  }

  private heard(tx: EarlyTx): void {
    if (tx.slot <= this.cursor || this.early.has(tx.signature)) return;
    const at = Date.now();
    const trades: Trade[] = [];
    let idx = 0;
    for (const event of tx.events) {
      if (event.kind !== "trade") continue;
      const mint = event.venue === "amm" ? this.pools.get(event.mint.slice(5)) : event.mint;
      const place = idx++;
      if (!mint || !this.markets.has(mint)) continue;
      trades.push({
        signature: tx.signature,
        idx: place,
        mint,
        slot: tx.slot,
        txIndex: -1,
        at,
        wallet: event.wallet,
        isBuy: event.isBuy,
        venue: event.venue,
        sol: event.sol,
        tokens: event.tokens,
        price: priceOf(event.virtualSol, event.virtualTokens),
      });
    }
    if (trades.length === 0) return;
    this.early.set(tx.signature, tx.slot);
    this.events.early?.(tx, trades);
    this.wake?.();
  }

  // ---- applying one block ------------------------------------------------------------------

  private async apply(block: ChainBlock): Promise<void> {
    const at = block.time * 1000;
    const next = new Map<string, Market>();
    const created: string[] = [];
    const pools = new Map<string, string>();
    const trades: Trade[] = [];
    const candles = new Map<string, { mint: string; tf: Timeframe; candle: Candle }>();
    const balances = new Map<string, { mint: string; owner: string; amount: bigint }>();
    const touch = (mint: string | undefined): Market | undefined => {
      if (!mint) return undefined;
      let market = next.get(mint);
      if (!market) {
        const known = this.markets.get(mint);
        if (!known) return undefined;
        market = { ...known };
        next.set(mint, market);
      }
      return market;
    };
    const signatures: string[] = [];
    for (const tx of block.txs) {
      signatures.push(tx.signature);
      let idx = 0;
      for (const event of tx.events) {
        // A Meteora pool, new or trading. It is read only where every trade is followed, and only once the chain has
        // been asked which coin the pool trades: until then the pool waits, and its swaps are not guessed at.
        let meteora: PoolFacts | undefined;
        if ((event.kind === "damm2-pool" || event.kind === "damm2-swap") && !this.readMeteora) continue;
        if (event.kind === "damm2-pool") {
          if (this.discover && !this.poolFacts.has(event.pool)) this.unreadPools.add(event.pool);
          continue;
        }
        if (event.kind === "damm2-swap") {
          const place = idx++;
          meteora = this.poolFacts.get(event.pool);
          if (!meteora) {
            if (this.discover && this.unreadPools.size < 20_000) this.unreadPools.add(event.pool);
            continue;
          }
          const trade = tradeFrom(event, meteora);
          if (!trade) continue;
          let market = touch(meteora.mint);
          if (!market && this.discover && !this.markets.has(meteora.mint) && !next.has(meteora.mint)) {
            market = fromPool(meteora, trade, block.slot, at);
            next.set(market.mint, market);
            created.push(market.mint);
          }
          if (!market || market.quote) continue;
          const where = { signature: tx.signature, idx: place, slot: block.slot, txIndex: tx.index, at };
          // The pool a coin's price is taken from: the one it was first seen in, until another is seen holding more SOL.
          const prices = market.venue === "damm2" && (market.pool === meteora.pool || trade.realSol > market.realSol);
          if (prices) {
            market.pool = meteora.pool;
            trades.push(await this.tradeInto(market, trade, where, candles));
          } else {
            // A second pool of a coin priced elsewhere (a pump.fun coin, or a coin with a deeper pool). The trade counts:
            // it is listed, it adds to volume, its balances move. It does not move the coin's price or its chart.
            market.trades += 1;
            market.lastTradeAt = at;
            const price = priceOf(trade.virtualSol, trade.virtualTokens);
            trades.push({
              ...where,
              mint: market.mint,
              wallet: trade.wallet,
              isBuy: trade.isBuy,
              venue: "damm2",
              sol: trade.sol,
              tokens: trade.tokens,
              price,
              priceBefore: price,
            });
          }
          continue;
        }
        if (event.kind === "create") {
          if (this.markets.has(event.mint) || next.has(event.mint)) continue;
          next.set(event.mint, {
            mint: event.mint,
            creator: event.creator,
            name: event.name,
            symbol: event.symbol,
            uri: event.uri,
            createdAt: at,
            createdSlot: block.slot,
            supply: event.supply,
            initialRealTokens: event.realTokens,
            virtualSol: event.virtualSol,
            virtualTokens: event.virtualTokens,
            realSol: 0n,
            realTokens: event.realTokens,
            complete: false,
            holders: 0,
            trades: 0,
            ...(event.quoteMint ? { quote: event.quoteMint } : {}),
          });
          created.push(event.mint);
        } else if (event.kind === "complete") {
          const market = touch(event.mint);
          if (market && !market.complete) {
            market.complete = true;
            market.completedAt = at;
          }
        } else if (event.kind === "pool") {
          const market = touch(event.mint);
          if (market) {
            market.pool = event.pool;
            market.complete = true;
            market.completedAt ??= at;
            pools.set(event.pool, event.mint);
          }
        } else {
          const place = idx++;
          const mint = event.venue === "amm" ? (pools.get(event.mint.slice(5)) ?? this.pools.get(event.mint.slice(5))) : event.mint;
          let market = touch(mint);
          if (!market && this.discover) {
            // A coin that was trading before this indexer began to listen. It is followed from here on, and says so:
            // its name, its creator and everything before this trade are not known until they are read from the chain.
            const found = discovered(event, tx, block.slot, at);
            if (found && !this.markets.has(found.mint) && !next.has(found.mint)) {
              next.set(found.mint, found);
              created.push(found.mint);
              if (found.pool) pools.set(found.pool, found.mint);
              market = found;
            }
          }
          if (!market || market.quote) continue;
          const trade = await this.tradeInto(market, event, { signature: tx.signature, idx: place, slot: block.slot, txIndex: tx.index, at }, candles);
          trades.push(trade);
        }
      }
      for (const balance of tx.balances) {
        const held = next.get(balance.mint) ?? this.markets.get(balance.mint);
        if (!held) continue;
        // A coin with other than six decimals is held here in millionths of a coin, like every other.
        balances.set(
          `${balance.mint}|${balance.owner}`,
          held.decimals === undefined ? balance : { ...balance, amount: toMillionths(balance.amount, held.decimals) },
        );
      }
    }

    const holders = [...balances.values()];
    await this.db.tx(async (sql) => {
      await sql.query("insert into blocks (slot, hash, parent_slot, parent_hash, at) values ($1, $2, $3, $4, $5)", [
        block.slot,
        block.hash,
        block.parentSlot,
        block.parentHash,
        at,
      ]);
      await sql.query("insert into meta (key, value) values ('cursor', $1) on conflict (key) do update set value = excluded.value", [String(block.slot)]);
      if (holders.length > 0) {
        // What each holder had before, for the count of holders and for undoing this block.
        const pairs = JSON.stringify(holders.map((holder) => ({ mint: holder.mint, owner: holder.owner })));
        const before = new Map<string, { amount: string; slot: number }>();
        for (const row of await sql.query<{ mint: string; owner: string; amount: string; slot: number }>(
          "select h.mint, h.owner, h.amount::text as amount, h.slot from holders h join jsonb_to_recordset($1::jsonb) as x(mint text, owner text) on x.mint = h.mint and x.owner = h.owner",
          [pairs],
        ))
          before.set(`${row.mint}|${row.owner}`, { amount: row.amount, slot: Number(row.slot) });
        const undo = holders.map((holder) => {
          const was = before.get(`${holder.mint}|${holder.owner}`);
          const had = was ? BigInt(was.amount) > 0n : false;
          if (had !== holder.amount > 0n) {
            const market = touch(holder.mint);
            if (market) market.holders += holder.amount > 0n ? 1 : -1;
          }
          return { slot: block.slot, mint: holder.mint, owner: holder.owner, amount: was?.amount ?? null, prev_slot: was?.slot ?? null };
        });
        await sql.query(
          "insert into holder_undo (slot, mint, owner, amount, prev_slot) select slot, mint, owner, amount::numeric, prev_slot from jsonb_to_recordset($1::jsonb) as x(slot bigint, mint text, owner text, amount text, prev_slot bigint)",
          [JSON.stringify(undo)],
        );
        await sql.query(
          `insert into holders (mint, owner, amount, slot) select mint, owner, amount::numeric, $2 from jsonb_to_recordset($1::jsonb) as x(mint text, owner text, amount text)
           on conflict (mint, owner) do update set amount = excluded.amount, slot = excluded.slot`,
          [JSON.stringify(holders.map((holder) => ({ mint: holder.mint, owner: holder.owner, amount: holder.amount.toString() }))), block.slot],
        );
      }
      if (next.size > 0) {
        const mints = JSON.stringify([...next.keys()]);
        await sql.query(
          `insert into market_undo (slot, mint, body) select $1, x.mint, (select to_jsonb(m) from markets m where m.mint = x.mint) from jsonb_array_elements_text($2::jsonb) as x(mint)`,
          [block.slot, mints],
        );
        await writeMarkets(sql, [...next.values()]);
      }
      if (trades.length > 0)
        await sql.query(
          `insert into trades (signature, idx, mint, slot, tx_index, at, wallet, is_buy, venue, sol, tokens, price, price_before, virtual_sol, virtual_tokens, real_sol, real_tokens)
           select signature, idx, mint, slot, tx_index, at, wallet, is_buy, venue, sol::numeric, tokens::numeric, price::numeric, price_before::numeric, 0, 0, 0, 0
           from jsonb_to_recordset($1::jsonb) as x(signature text, idx int, mint text, slot bigint, tx_index int, at bigint, wallet text, is_buy boolean, venue text, sol text, tokens text, price text, price_before text)`,
          [
            JSON.stringify(
              trades.map((trade) => ({
                signature: trade.signature,
                idx: trade.idx,
                mint: trade.mint,
                slot: trade.slot,
                tx_index: trade.txIndex,
                at: trade.at,
                wallet: trade.wallet,
                is_buy: trade.isBuy,
                venue: trade.venue,
                sol: trade.sol.toString(),
                tokens: trade.tokens.toString(),
                price: trade.price.toString(),
                price_before: (trade.priceBefore ?? 0n).toString(),
              })),
            ),
          ],
        );
      if (candles.size > 0) await writeCandles(sql, [...candles.values()]);
      if (block.slot % 50 === 0) {
        const floor = block.slot - UNDO_DEPTH;
        await sql.query("delete from blocks where slot < $1", [floor]);
        await sql.query("delete from holder_undo where slot < $1", [floor]);
        await sql.query("delete from market_undo where slot < $1", [floor]);
      }
    });

    // Committed. Only now does memory change, and only now is anyone told.
    for (const market of next.values()) this.markets.set(market.mint, market);
    for (const [pool, mint] of pools) this.pools.set(pool, mint);
    for (const { mint, tf, candle } of candles.values()) {
      const list = await this.candles(mint, tf);
      if (list[list.length - 1]?.t === candle.t) list[list.length - 1] = candle;
      else list.push(candle);
      if (list.length > CANDLES_KEPT) list.splice(0, list.length - CANDLES_KEPT);
    }
    for (const trade of trades) {
      const cached = this.recentCache.get(trade.mint);
      if (!cached) continue;
      const list = await cached;
      list.push(trade);
      if (list.length > RECENT_KEPT) list.splice(0, list.length - RECENT_KEPT);
    }
    for (const signature of signatures) this.early.delete(signature);
    this.tip = { slot: block.slot, hash: block.hash };
    this.lastAppliedAt = Date.now();
    if (trades.length > 0 || next.size > 0 || holders.length > 0)
      this.events.applied?.({
        slot: block.slot,
        at,
        trades,
        markets: [...next.values()],
        created: created.map((mint) => next.get(mint)!),
        candles: [...candles.values()],
        holders,
        signatures,
      });
    this.moveCursor(block.slot);
  }

  private async tradeInto(
    market: Market,
    event: TradeEvent,
    where: { signature: string; idx: number; slot: number; txIndex: number; at: number },
    candles: Map<string, { mint: string; tf: Timeframe; candle: Candle }>,
  ): Promise<Trade> {
    const priceBefore = priceOf(market.virtualSol, market.virtualTokens);
    const before = Number(priceBefore);
    market.virtualSol = event.virtualSol;
    market.virtualTokens = event.virtualTokens;
    market.realSol = event.realSol;
    market.realTokens = event.realTokens;
    market.trades += 1;
    market.lastTradeAt = where.at;
    const price = priceOf(event.virtualSol, event.virtualTokens);
    const seconds = Math.floor(where.at / 1000);
    for (const tf of TIMEFRAMES) {
      const key = `${market.mint}|${tf}`;
      const list = await this.candles(market.mint, tf);
      const current = candles.get(key)?.candle ?? list[list.length - 1];
      candles.set(key, { mint: market.mint, tf, candle: extend(current, bucketOf(seconds, tf), before, Number(price), Number(event.sol), event.isBuy) });
    }
    return {
      ...where,
      mint: market.mint,
      wallet: event.wallet,
      isBuy: event.isBuy,
      venue: event.venue,
      sol: event.sol,
      tokens: event.tokens,
      price,
      priceBefore,
    };
  }

  // ---- reorganisation ----------------------------------------------------------------------

  /** `block` does not follow the last block applied. Finds where the two histories part, undoes ours above it, and applies theirs up to `block`'s parent. */
  private async reorganise(block: ChainBlock): Promise<void> {
    const ours = new Map<number, string>();
    for (const row of await this.db.query<{ slot: number; hash: string }>("select slot, hash from blocks")) ours.set(Number(row.slot), row.hash);
    const theirs: ChainBlock[] = [];
    let parent = { slot: block.parentSlot, hash: block.parentHash };
    while (ours.get(parent.slot) !== parent.hash) {
      const lowest = Math.min(...ours.keys());
      if (parent.slot < lowest || theirs.length > UNDO_DEPTH) {
        // Deeper than anything kept. Undo all that can be undone and carry on from there; say so loudly.
        this.log("error", "a reorganisation went deeper than the blocks kept", { slot: block.slot, depth: UNDO_DEPTH });
        parent = { slot: lowest - 1, hash: "" };
        theirs.length = 0;
        break;
      }
      const missing = await this.source.block(parent.slot);
      if (!missing) throw new Error(`block ${parent.slot} is named as a parent but the chain does not have it`);
      theirs.unshift(missing);
      parent = { slot: missing.parentSlot, hash: missing.parentHash };
    }
    this.log("warn", "the chain reorganised", { from: this.tip?.slot, to: parent.slot, replaying: theirs.length });
    await this.undoAbove(parent.slot);
    for (const replay of theirs) await this.apply(replay);
  }

  private async undoAbove(slot: number): Promise<void> {
    const mints = await this.db.tx(async (sql) => {
      const dropped = await sql.query<{ mint: string; first: number }>("delete from trades where slot > $1 returning mint, at as first", [slot]);
      const earliest = new Map<string, number>();
      for (const row of dropped) earliest.set(row.mint, Math.min(earliest.get(row.mint) ?? Infinity, Number(row.first)));
      // Holders and markets go back to what they were before the lowest undone block that touched them.
      await sql.query(
        `with first as (select distinct on (mint, owner) mint, owner, amount, prev_slot from holder_undo where slot > $1 order by mint, owner, slot asc),
              gone as (delete from holders h using first f where h.mint = f.mint and h.owner = f.owner and f.amount is null)
         update holders h set amount = f.amount, slot = f.prev_slot from first f where h.mint = f.mint and h.owner = f.owner and f.amount is not null`,
        [slot],
      );
      const before = await sql.query<{ mint: string; body: Record<string, unknown> | null }>(
        "select distinct on (mint) mint, body from market_undo where slot > $1 order by mint, slot asc",
        [slot],
      );
      for (const row of before) {
        if (row.body === null) await sql.query("delete from markets where mint = $1", [row.mint]);
        else
          await sql.query(
            `insert into markets (${MARKET_NAMES.join(", ")}) select ${MARKET_NAMES.join(", ")} from jsonb_to_record($1::jsonb) as x(${MARKET_RECORD})
             on conflict (mint) do update set ${MARKET_NAMES.filter((name) => name !== "mint")
               .map((name) => `${name} = excluded.${name}`)
               .join(", ")}`,
            [JSON.stringify(row.body)],
          );
        if (row.body === null) {
          await sql.query("delete from candles where mint = $1", [row.mint]);
          await sql.query("delete from holders where mint = $1", [row.mint]);
          earliest.delete(row.mint);
        }
      }
      for (const [mint, at] of earliest) await rebuildCandles(sql, mint, Math.floor(at / 1000));
      await sql.query("delete from holder_undo where slot > $1", [slot]);
      await sql.query("delete from market_undo where slot > $1", [slot]);
      await sql.query("delete from blocks where slot > $1", [slot]);
      await sql.query("insert into meta (key, value) values ('cursor', $1) on conflict (key) do update set value = excluded.value", [String(slot)]);
      return [...new Set([...dropped.map((row) => row.mint), ...before.map((row) => row.mint)])];
    });
    await this.load();
    this.cursor = slot;
    this.events.reorg?.(slot, mints);
  }

  // ---- a coin made before the indexer was following -------------------------------------------

  /**
   * Starts following a coin that already exists. `now` is its curve as the chain has it at this moment; from
   * here on the follower keeps it up to date. Returns false if it was already followed.
   */
  async adopt(now: Market): Promise<boolean> {
    if (this.markets.has(now.mint)) return false;
    await this.db.tx((sql) => writeMarkets(sql, [now]));
    this.markets.set(now.mint, { ...now });
    if (now.pool) this.pools.set(now.pool, now.mint);
    return true;
  }
  /**
   * Adds a followed coin's past: trades from before it was followed, and who holds it now. Trades the follower
   * has already stored are left alone; candles are rebuilt from everything stored, so past and present join up.
   */
  async backfill(mint: string, history: Trade[], holders: { owner: string; amount: bigint }[]): Promise<void> {
    const count = await this.db.tx(async (sql) => {
      for (let start = 0; start < history.length; start += 500)
        await sql.query(
          `insert into trades (signature, idx, mint, slot, tx_index, at, wallet, is_buy, venue, sol, tokens, price, price_before, virtual_sol, virtual_tokens, real_sol, real_tokens)
           select signature, idx, mint, slot, tx_index, at, wallet, is_buy, venue, sol::numeric, tokens::numeric, price::numeric, price_before::numeric, 0, 0, 0, 0
           from jsonb_to_recordset($1::jsonb) as x(signature text, idx int, mint text, slot bigint, tx_index int, at bigint, wallet text, is_buy boolean, venue text, sol text, tokens text, price text, price_before text)
           on conflict (signature, idx) do nothing`,
          [
            JSON.stringify(
              history.slice(start, start + 500).map((trade) => ({
                signature: trade.signature,
                idx: trade.idx,
                mint: trade.mint,
                slot: trade.slot,
                tx_index: trade.txIndex,
                at: trade.at,
                wallet: trade.wallet,
                is_buy: trade.isBuy,
                venue: trade.venue,
                sol: trade.sol.toString(),
                tokens: trade.tokens.toString(),
                price: trade.price.toString(),
                price_before: (trade.priceBefore ?? 0n).toString(),
              })),
            ),
          ],
        );
      // A holder the follower has already seen change keeps the newer figure.
      if (holders.length > 0)
        await sql.query(
          `insert into holders (mint, owner, amount, slot) select $2, owner, amount::numeric, 0 from jsonb_to_recordset($1::jsonb) as x(owner text, amount text)
           on conflict (mint, owner) do nothing`,
          [JSON.stringify(holders.map((holder) => ({ owner: holder.owner, amount: holder.amount.toString() }))), mint],
        );
      await rebuildCandles(sql, mint, 0);
      const counted = (
        await sql.query<{ trades: number; holders: number; last: number | null }>(
          "select (select count(*)::int from trades where mint = $1) as trades, (select count(*)::int from holders where mint = $1 and amount > 0) as holders, (select max(at) from trades where mint = $1) as last",
          [mint],
        )
      )[0]!;
      await sql.query("update markets set trades = $2, holders = $3, last_trade_at = $4 where mint = $1", [
        mint,
        counted.trades,
        counted.holders,
        counted.last,
      ]);
      return counted;
    });
    const market = this.markets.get(mint);
    if (market) {
      market.trades = count.trades;
      market.holders = count.holders;
      if (count.last !== null) market.lastTradeAt = Number(count.last);
    }
    for (const tf of TIMEFRAMES) this.candleCache.delete(`${mint}|${tf}`);
    this.recentCache.delete(mint);
  }

  /**
   * Stops following coins: everything stored about them is deleted in one step, and they leave memory.
   * Which coins is not decided here (lib/server/indexer/retention.ts). A coin dropped and later traded again is
   * simply seen again, as any coin never followed would be.
   */
  async drop(mints: string[]): Promise<void> {
    const known = mints.filter((mint) => this.markets.has(mint));
    if (known.length === 0) return;
    const list = JSON.stringify(known);
    await this.db.tx(async (sql) => {
      for (const table of ["trades", "candles", "holders", "holder_undo", "market_undo", "markets"])
        await sql.query(`delete from ${table} where mint in (select jsonb_array_elements_text($1::jsonb))`, [list]);
    });
    for (const mint of known) {
      const market = this.markets.get(mint);
      if (market?.pool) this.pools.delete(market.pool);
      this.markets.delete(mint);
      for (const tf of TIMEFRAMES) this.candleCache.delete(`${mint}|${tf}`);
      this.recentCache.delete(mint);
    }
  }
  /** Fills in what a coin first seen through a trade could not say of itself, once it has been read from the chain. */
  async describe(mint: string, read: { name: string; symbol: string; uri: string; creator: string }): Promise<void> {
    const market = this.markets.get(mint);
    if (!market) return;
    await this.db.tx((sql) =>
      sql.query("update markets set name = $2, symbol = $3, uri = $4, creator = $5 where mint = $1", [mint, read.name, read.symbol, read.uri, read.creator]),
    );
    Object.assign(market, read);
  }

  /** Sets a coin's supply to what its mint on the chain says. */
  async resupply(mint: string, supply: bigint): Promise<void> {
    const market = this.markets.get(mint);
    if (!market) return;
    await this.db.tx((sql) => sql.query("update markets set supply = $2 where mint = $1", [mint, supply.toString()]));
    market.supply = supply;
  }

  /** Records what a followed coin's own creation event said of it, once its past has been read. */
  async rename(mint: string, created: { name: string; symbol: string; uri: string; at: number; slot: number }): Promise<void> {
    await this.db.tx((sql) =>
      sql.query("update markets set name = $2, symbol = $3, uri = $4, created_at = $5, created_slot = $6, seen_from = null where mint = $1", [
        mint,
        created.name,
        created.symbol,
        created.uri,
        created.at,
        created.slot,
      ]),
    );
  }

  // ---- reads ------------------------------------------------------------------------------

  /** The newest candles of a coin, oldest first. Held in memory after the first read. */
  candles(mint: string, tf: Timeframe): Promise<Candle[]> {
    const key = `${mint}|${tf}`;
    let cached = this.candleCache.get(key);
    if (!cached) {
      cached = this.db
        .query<CandleRow>(
          "select t, o::text, h::text, l::text, c::text, vol_sol::text, n, buys from candles where mint = $1 and tf = $2 order by t desc limit $3",
          [mint, tf, CANDLES_KEPT],
        )
        .then((rows) => rows.reverse().map(candleFromRow));
      this.candleCache.set(key, cached);
      cached.catch(() => this.candleCache.delete(key));
      if (this.candleCache.size > 6000) for (const old of [...this.candleCache.keys()].slice(0, 1000)) this.candleCache.delete(old);
    }
    return cached;
  }
  /** Candles older than what memory holds, oldest first: those ending before `before` (seconds). */
  async candlesBefore(mint: string, tf: Timeframe, before: number, limit: number): Promise<Candle[]> {
    const rows = await this.db.query<CandleRow>(
      "select t, o::text, h::text, l::text, c::text, vol_sol::text, n, buys from candles where mint = $1 and tf = $2 and t < $3 order by t desc limit $4",
      [mint, tf, before, limit],
    );
    return rows.reverse().map(candleFromRow);
  }
  /** The newest trades of a coin, oldest first. Held in memory after the first read. */
  recent(mint: string): Promise<Trade[]> {
    let cached = this.recentCache.get(mint);
    if (!cached) {
      cached = this.db
        .query<TradeRow>(`select ${TRADE_COLUMNS} from trades where mint = $1 order by slot desc, tx_index desc, idx desc limit $2`, [mint, RECENT_KEPT])
        .then((rows) => rows.reverse().map(tradeFromRow));
      this.recentCache.set(mint, cached);
      cached.catch(() => this.recentCache.delete(mint));
      if (this.recentCache.size > 2000) for (const old of [...this.recentCache.keys()].slice(0, 400)) this.recentCache.delete(old);
    }
    return cached;
  }
  /** Trades of a coin older than a given one, newest first. `wallet` narrows them to one wallet's. */
  async tradesBefore(mint: string, before: { slot: number; txIndex: number; idx: number } | null, limit: number, wallet?: string): Promise<Trade[]> {
    const rows = await this.db.query<TradeRow>(
      `select ${TRADE_COLUMNS} from trades where mint = $1 and ($2::bigint is null or (slot, tx_index, idx) < ($2::bigint, $3::int, $4::int)) and ($5::text is null or wallet = $5)
       order by slot desc, tx_index desc, idx desc limit $6`,
      [mint, before?.slot ?? null, before?.txIndex ?? 0, before?.idx ?? 0, wallet ?? null, limit],
    );
    return rows.map(tradeFromRow);
  }
  /** The largest holders of a coin. */
  async topHolders(mint: string, limit: number): Promise<{ owner: string; amount: bigint }[]> {
    const rows = await this.db.query<{ owner: string; amount: string }>(
      "select owner, amount::text as amount from holders where mint = $1 and amount > 0 order by amount desc limit $2",
      [mint, limit],
    );
    return rows.map((row) => ({ owner: row.owner, amount: BigInt(row.amount) }));
  }
  /** What a wallet holds of every followed coin. */
  async holdings(wallet: string): Promise<{ mint: string; amount: bigint }[]> {
    const rows = await this.db.query<{ mint: string; amount: string }>("select mint, amount::text as amount from holders where owner = $1 and amount > 0", [
      wallet,
    ]);
    return rows.map((row) => ({ mint: row.mint, amount: BigInt(row.amount) }));
  }
  /** What a wallet has bought and sold, per coin: the sums its position and profit are worked out from. */
  async flows(
    wallet: string,
    mint?: string,
  ): Promise<{ mint: string; boughtSol: bigint; boughtTokens: bigint; soldSol: bigint; soldTokens: bigint; buys: number; sells: number; lastAt: number }[]> {
    const rows = await this.db.query<{ mint: string; bs: string; bt: string; ss: string; st: string; nb: number; ns: number; last: number }>(
      `select mint,
              coalesce(sum(sol) filter (where is_buy), 0)::text as bs, coalesce(sum(tokens) filter (where is_buy), 0)::text as bt,
              coalesce(sum(sol) filter (where not is_buy), 0)::text as ss, coalesce(sum(tokens) filter (where not is_buy), 0)::text as st,
              (count(*) filter (where is_buy))::int as nb, (count(*) filter (where not is_buy))::int as ns, max(at) as last
       from trades where wallet = $1 and ($2::text is null or mint = $2) group by mint`,
      [wallet, mint ?? null],
    );
    return rows.map((row) => ({
      mint: row.mint,
      boughtSol: BigInt(row.bs),
      boughtTokens: BigInt(row.bt),
      soldSol: BigInt(row.ss),
      soldTokens: BigInt(row.st),
      buys: row.nb,
      sells: row.ns,
      lastAt: Number(row.last),
    }));
  }
  /** Whether a transaction's block has been applied and carried a trade. */
  async tradesOf(signature: string): Promise<Trade[]> {
    return (await this.db.query<TradeRow>(`select ${TRADE_COLUMNS} from trades where signature = $1 order by idx`, [signature])).map(tradeFromRow);
  }
}

async function writeMarkets(sql: Sql, markets: Market[]): Promise<void> {
  await sql.query(
    `insert into markets (${MARKET_NAMES.join(", ")}) select ${MARKET_NAMES.join(", ")} from jsonb_to_recordset($1::jsonb) as x(${MARKET_RECORD})
     on conflict (mint) do update set ${MARKET_NAMES.filter((name) => name !== "mint")
       .map((name) => `${name} = excluded.${name}`)
       .join(", ")}`,
    [JSON.stringify(markets.map(toRow))],
  );
}
async function writeCandles(sql: Sql, candles: { mint: string; tf: number; candle: Candle }[]): Promise<void> {
  await sql.query(
    `insert into candles (mint, tf, t, o, h, l, c, vol_sol, vol_tokens, n, buys)
     select mint, tf, t, o, h, l, c, v, 0, n, b from jsonb_to_recordset($1::jsonb) as x(mint text, tf int, t bigint, o numeric, h numeric, l numeric, c numeric, v numeric, n int, b int)
     on conflict (mint, tf, t) do update set o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, vol_sol = excluded.vol_sol, n = excluded.n, buys = excluded.buys`,
    [JSON.stringify(candles.map(({ mint, tf, candle }) => ({ mint, tf, ...candle })))],
  );
}

/** Rebuilds every candle of a coin from `fromSeconds` on, out of the trades that are stored. */
export async function rebuildCandles(sql: Sql, mint: string, fromSeconds: number): Promise<void> {
  for (const tf of TIMEFRAMES) {
    const start = bucketOf(fromSeconds, tf);
    await sql.query("delete from candles where mint = $1 and tf = $2 and t >= $3", [mint, tf, start]);
    const rebuilt: Candle[] = [];
    for (const row of await sql.query<{ at: number; price: string; price_before: string; sol: string; is_buy: boolean }>(
      "select at, price::text as price, price_before::text as price_before, sol::text as sol, is_buy from trades where mint = $1 and at >= $2 order by slot, tx_index, idx",
      [mint, start * 1000],
    )) {
      const bucket = bucketOf(Math.floor(Number(row.at) / 1000), tf);
      const last = rebuilt[rebuilt.length - 1];
      const candle = extend(last, bucket, Number(row.price_before), Number(row.price), Number(row.sol), row.is_buy);
      if (last?.t === bucket) rebuilt[rebuilt.length - 1] = candle;
      else rebuilt.push(candle);
    }
    if (rebuilt.length > 0)
      await writeCandles(
        sql,
        rebuilt.map((candle) => ({ mint, tf, candle })),
      );
  }
}
