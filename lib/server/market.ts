/**
 * The market service: one indexer, one live hub, and the views everything else reads.
 * Reads here never go to the chain. They come from memory, or from the database for older history.
 */
import { curveAddress } from "./pump";
import { Hub } from "./live";
import { failure, log } from "./log";
import { Indexer, type Applied } from "./indexer/indexer";
import { marketCapOf, priceOf, progressOf, type Candle, type Market, type Trade } from "./indexer/model";
import { RpcSource } from "./indexer/rpc-source";
import type { ChainSource } from "./indexer/types";
import type { CoinView, TradeView } from "../contract";
import { coinsToDrop } from "./indexer/retention";
import { ringAvailable, settings } from "./env";
import { ring } from "./ring";
import { forgetBalances } from "./balances";
import { connection } from "./solana";
import { database, onForget, state } from "./store";

const BOARD_SHOWN = 400;
const PATCH_MS = 200;
/** How often coins nobody trades are looked for and dropped. */
const TIDY_EVERY_MS = 60_000;
/** A coin somebody opened is kept this long after, whatever its trading. */
const KEEP_ASKED_MS = 24 * 3_600_000;

export const tradeView = (trade: Trade, early = false): TradeView => ({
  s: trade.signature,
  i: trade.idx,
  t: trade.at,
  w: trade.wallet,
  b: trade.isBuy ? 1 : 0,
  x: trade.txIndex,
  sol: Number(trade.sol),
  tok: Number(trade.tokens),
  p: Number(trade.price),
  v: trade.venue === "amm" ? "a" : "c",
  slot: trade.slot,
  ...(early ? { early: 1 as const } : {}),
});
export const candleWire = (candle: Candle): number[] => [candle.t, candle.o, candle.h, candle.l, candle.c, candle.v, candle.n, candle.b];

interface Stats {
  volume24h: number;
  change: { m5: number | null; h1: number | null; h24: number | null };
}
/** The close of the last candle at or before a time, or the first candle's open for a coin younger than that. */
function priceAt(candles: Candle[], seconds: number): number | null {
  if (candles.length === 0) return null;
  let found: Candle | undefined;
  for (let index = candles.length - 1; index >= 0; index--) {
    if (candles[index]!.t <= seconds) {
      found = candles[index];
      break;
    }
  }
  return found ? found.c : candles[0]!.o;
}
const changeBps = (from: number | null, to: number): number | null => (from === null || from <= 0 ? null : Math.round(((to - from) / from) * 10_000));

export class MarketService {
  readonly hub = new Hub();
  readonly indexer: Indexer;
  private readonly dirty = new Set<string>();
  private readonly sent = new Map<string, CoinView>();
  private patchTimer: ReturnType<typeof setTimeout> | undefined;
  /** Called with each applied block, after the hub has been told: for settling deposits and for tests. */
  readonly onApplied = new Set<(block: Applied) => void>();

  constructor(source: ChainSource) {
    this.indexer = new Indexer(
      database(),
      source,
      {
        applied: (block) => this.applied(block),
        early: (_tx, trades) => {
          for (const trade of trades) this.hub.publish(`coin:${trade.mint}`, ["e", tradeView(trade, true)]);
        },
        reorg: (_slot, mints) => {
          this.sent.clear();
          for (const mint of mints) {
            this.hub.reset(`coin:${mint}`);
            for (const tf of [1, 60, 300, 900, 3600, 86400]) this.hub.reset(`k:${mint}:${tf}`);
          }
          this.hub.reset("board");
        },
      },
      (level, message, fields) => log(level, message, fields),
      undefined,
      settings().feedScope === "all",
    );
    this.tidying = setInterval(
      () => void this.tidy().catch((error: unknown) => log("error", "dropping dead coins failed", { error: String(error) })),
      TIDY_EVERY_MS,
    );
  }

  /** When each coin was last asked for by name, so one somebody has open or opened lately is not dropped. */
  private readonly asked = new Map<string, number>();
  private readonly tidying: ReturnType<typeof setInterval>;
  /** Notes that somebody asked for this coin. */
  wanted(mint: string): void {
    this.asked.set(mint, Date.now());
  }
  /** True for a coin that must stay followed whatever its trading: see lib/server/indexer/retention.ts. */
  private needed(mint: string, now: number): boolean {
    if (state().coins.some((coin) => coin.mint === mint)) return true;
    if (this.hub.hasListeners(`coin:${mint}`)) return true;
    if (now - (this.asked.get(mint) ?? 0) < KEEP_ASKED_MS) return true;
    return ringAvailable() && ring.coinStats(mint).inRing > 0n;
  }
  /** Stops following coins nobody trades or needs, and tells the board they are gone. Returns how many. */
  async tidy(now = Date.now()): Promise<number> {
    const gone = coinsToDrop(this.indexer.markets.values(), now, (mint) => this.needed(mint, now));
    if (gone.length === 0) return 0;
    await this.indexer.drop(gone);
    for (const mint of gone) {
      this.sent.delete(mint);
      this.dirty.delete(mint);
      this.asked.delete(mint);
      this.hub.publish("board", ["x", mint]);
    }
    log("info", "stopped following quiet coins", { dropped: gone.length, followed: this.indexer.markets.size });
    return gone.length;
  }

  private applied(block: Applied): void {
    for (const trade of block.trades) {
      const wire = ["t", tradeView(trade)];
      this.hub.publish(`coin:${trade.mint}`, wire);
      this.hub.publish(`wallet:${trade.wallet}`, wire);
    }
    for (const { mint, tf, candle } of block.candles) this.hub.publish(`k:${mint}:${tf}`, ["k", candleWire(candle)]);
    // What the page shows of a wallet is read again after anything that moved its coins or its SOL.
    for (const trade of block.trades) forgetBalances(trade.wallet);
    for (const holder of block.holders) {
      forgetBalances(holder.owner);
      this.hub.publish(`coin:${holder.mint}`, ["h", holder.owner, holder.amount.toString()]);
      this.hub.publish(`wallet:${holder.owner}`, ["b", holder.mint, holder.amount.toString()]);
    }
    for (const market of block.markets) this.dirty.add(market.mint);
    this.patchTimer ??= setTimeout(() => void this.patch(), PATCH_MS);
    for (const listener of this.onApplied) listener(block);
  }

  /** Has a coin's current figures sent out again: after its past has been filled in. */
  touch(mint: string): void {
    this.dirty.add(mint);
    this.patchTimer ??= setTimeout(() => void this.patch(), PATCH_MS);
  }

  /** Tells the board and each coin's own channel what changed about a coin, and only what changed. */
  private async patch(): Promise<void> {
    this.patchTimer = undefined;
    const mints = [...this.dirty];
    this.dirty.clear();
    for (const mint of mints) {
      try {
        const view = await this.view(mint);
        if (!view) continue;
        const before = this.sent.get(mint);
        this.sent.set(mint, view);
        if (!before) {
          this.hub.publish("board", ["n", view]);
          this.hub.publish(`coin:${mint}`, ["m", view]);
          continue;
        }
        const changed: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(view))
          if (JSON.stringify(value) !== JSON.stringify((before as unknown as Record<string, unknown>)[key])) changed[key] = value;
        if (Object.keys(changed).length === 0) continue;
        this.hub.publish("board", ["u", mint, changed]);
        this.hub.publish(`coin:${mint}`, ["m", changed]);
      } catch (error) {
        log("warn", "a coin's update could not be worked out", { mint, ...failure(error) });
      }
    }
  }

  private async stats(market: Market): Promise<Stats> {
    const [minutes, fives] = await Promise.all([this.indexer.candles(market.mint, 60), this.indexer.candles(market.mint, 300)]);
    const now = Math.floor(Date.now() / 1000);
    const price = Number(priceOf(market.virtualSol, market.virtualTokens));
    let volume24h = 0;
    for (let index = fives.length - 1; index >= 0 && fives[index]!.t > now - 86_400; index--) volume24h += fives[index]!.v;
    return {
      volume24h,
      change: {
        m5: changeBps(priceAt(minutes, now - 300), price),
        h1: changeBps(priceAt(minutes, now - 3600), price),
        h24: changeBps(priceAt(fives, now - 86_400), price),
      },
    };
  }

  /** Everything shown about one coin, from memory. Undefined if the indexer does not follow it. */
  async view(mint: string): Promise<CoinView | undefined> {
    const market = this.indexer.markets.get(mint);
    if (!market) return undefined;
    const listed = state().coins.find((coin) => coin.mint === mint);
    const stats = await this.stats(market);
    const inRing = ringAvailable() ? ring.coinStats(mint) : { inRing: 0n, depositors: 0 };
    // The curve itself, or the pool after it, holds coins but is not a holder in the sense anyone means.
    const venueHolds = market.complete ? (market.pool ? 1 : 0) : market.realTokens > 0n ? 1 : 0;
    return {
      mint,
      name: listed?.name ?? market.name,
      symbol: listed?.symbol ?? market.symbol,
      creator: market.creator,
      createdAt: market.createdAt,
      signature: listed?.signature ?? "",
      ...(listed?.image ? { image: listed.image } : {}),
      launchedHere: listed !== undefined,
      ...(market.seenFromSlot === undefined ? {} : { followedSince: market.createdAt }),
      ...(market.quote ? { unsupported: { reason: "quote" as const, quote: market.quote } } : {}),
      marketCapLamports: marketCapOf(market).toString(),
      microLamportsPerCoin: priceOf(market.virtualSol, market.virtualTokens).toString(),
      changeBasisPoints: stats.change.h24 ?? 0,
      changeSince: Math.max(market.createdAt, Date.now() - 86_400_000),
      change: stats.change,
      volume24hLamports: String(stats.volume24h),
      complete: market.complete,
      hasPool: market.pool !== undefined,
      progressBps: progressOf(market),
      holders: Math.max(0, market.holders - venueHolds),
      trades: market.trades,
      ...(market.lastTradeAt === undefined ? {} : { lastTradeAt: market.lastTradeAt }),
      privacy: {
        supply: market.supply.toString(),
        inRing: inRing.inRing.toString(),
        shareInRingPartsPerMillion: market.supply > 0n ? Number((inRing.inRing * 1_000_000n) / market.supply) : 0,
        walletsThatDeposited: inRing.depositors,
      },
    };
  }

  /** The coins the indexer follows, most recently active first. `seq` is the board channel's number as of this answer. */
  async board(): Promise<{ coins: CoinView[]; seq: number }> {
    const seq = this.hub.seq("board");
    const newest = [...this.indexer.markets.values()].sort((a, b) => (b.lastTradeAt ?? b.createdAt) - (a.lastTradeAt ?? a.createdAt)).slice(0, BOARD_SHOWN);
    const coins = (await Promise.all(newest.map((market) => this.view(market.mint)))).filter((view): view is CoinView => view !== undefined);
    for (const view of coins) if (!this.sent.has(view.mint)) this.sent.set(view.mint, view);
    return { coins: coins.sort((a, b) => b.createdAt - a.createdAt), seq };
  }

  /** The labels a holder's address carries: the curve, the pool, the creator, the Ring's stand-in. */
  tagsOf(market: Market, owner: string, escrow: string | null): string[] {
    const tags: string[] = [];
    if (owner === curveAddress(market.mint).toBase58()) tags.push("curve");
    if (owner === market.creator) tags.push("creator");
    if (escrow !== null && owner === escrow) tags.push("ring");
    return tags;
  }

  async stop(): Promise<void> {
    clearTimeout(this.patchTimer);
    clearInterval(this.tidying);
    await this.indexer.stop();
  }
}

let running: { key: string; service: Promise<MarketService> } | undefined;
/** For tests: a made-up chain instead of the RPC. Set before the service first starts. */
let sourceFor: (() => ChainSource) | undefined;
export function useSource(make: (() => ChainSource) | undefined): void {
  sourceFor = make;
}

/** The running market service for the current settings. The first call starts the indexer and waits until it has caught up. */
export function market(): Promise<MarketService> {
  // One service per database. The chain is reached through `connection`, wherever that points at the moment it is asked.
  const { databaseUrl, databaseSchema, dataDir } = settings();
  const key = `${databaseUrl}|${databaseSchema}|${dataDir}`;
  if (running?.key !== key) {
    const service = (async () => {
      const made = new MarketService(sourceFor ? sourceFor() : new RpcSource(connection));
      await made.indexer.start();
      return made;
    })();
    const mine = { key, service };
    running = mine;
    service.catch(() => {
      if (running === mine) running = undefined;
    });
    onForget(async () => {
      if (running === mine) running = undefined;
      await (await service.catch(() => undefined))?.stop();
    });
  }
  return running.service;
}
/** The service if it is already running, without starting it. */
export const runningMarket = (): Promise<MarketService> | undefined => running?.service;
