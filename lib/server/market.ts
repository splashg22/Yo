/**
 * The market service: one indexer, one live hub, and the views everything else reads.
 * Reads here never go to the chain. They come from memory, or from the database for older history.
 */
import { MAYHEM_VAULT, curveAddress } from "./pump";
import { Hub } from "./live";
import { failure, log } from "./log";
import { Indexer, type Applied } from "./indexer/indexer";
import { marketCapOf, priceOf, progressOf, type Candle, type Market, type Trade } from "./indexer/model";
import { AMM_PROGRAM, PUMP_PROGRAM } from "./indexer/decode";
import { HeliusTxStream, PUMP_MINT_AUTHORITY } from "./indexer/helius-stream";
import { RpcSource } from "./indexer/rpc-source";
import { StreamSource } from "./indexer/stream-source";
import { USDC, type ChainSource } from "./indexer/types";
import { knownSolPrice } from "./usd";
import type { ChecksView, CoinView, LiquidityCheck, TradeView, TraderView } from "../contract";
import { liquidityOf } from "./liquidity";
import { NEARLY_BPS } from "../board-filters";
import { coinImage, pictureKept, pictureRoom, pictureStats } from "./coin-image";
import { Describer } from "./describe";
import { DAMM2_AUTHORITY, DAMM2_PROGRAM } from "./indexer/meteora";
import { PoolReader } from "./pools";
import { HISTORY_LIMIT } from "./history-limit";
import { coinsToDrop } from "./indexer/retention";
import { riskOf, type Risk } from "./risk";
import { Rolling, WINDOWS, type WindowKey } from "./rolling";
import { ringAvailable, settings } from "./env";
import { ring } from "./ring";
import { forgetBalances } from "./balances";
import { connection } from "./solana";
import { database, onForget, state } from "./store";

/** The board's first answer: this many of each kind. The live channel adds to it from there. */
const BOARD_EACH = 150;
/** Every pump.fun coin is made with this many base units. Only a Mayhem coin's supply is more. */
const ONE_BILLION_COINS = 1_000_000_000_000_000n;
const SEARCH_SHOWN = 30;
const TRADERS_SHOWN = 100;
const DEV_COINS_SHOWN = 50;
const TRENDING_SHOWN = 100;
const PATCH_MS = 200;
/** How often coins nobody trades are looked for and dropped. */
const TIDY_EVERY_MS = 60_000;
/** How long a coin's risk figures are shown before they are worked out again, while it keeps trading. */
const RISK_GOOD_FOR_MS = 5_000;
/** How often the choice of coins followed trade by trade is made again. */
const REFOLLOW_EVERY_MS = 5_000;
/** A coin somebody opened is kept this long after, whatever its trading. */
const KEEP_ASKED_MS = 24 * 3_600_000;

/**
 * `rate`: what one of the trade's own money units is worth in lamports. 1 for a coin priced in SOL. For a coin
 * priced in USDC it is lamports for a millionth of a USDC at the price of SOL now, so the page, which shows dollars
 * as lamports times the price of SOL, shows the USDC that was actually paid.
 */
export const tradeView = (trade: Trade, early = false, rate = 1): TradeView => ({
  s: trade.signature,
  i: trade.idx,
  t: trade.at,
  w: trade.wallet,
  b: trade.isBuy ? 1 : 0,
  x: trade.txIndex,
  sol: rate === 1 ? Number(trade.sol) : Math.round(Number(trade.sol) * rate),
  tok: Number(trade.tokens),
  p: Number(trade.price) * rate,
  v: trade.venue === "amm" ? "a" : trade.venue === "damm2" ? "m" : "c",
  slot: trade.slot,
  ...(early ? { early: 1 as const } : {}),
});
export const candleWire = (candle: Candle, rate = 1): number[] => [
  candle.t,
  candle.o * rate,
  candle.h * rate,
  candle.l * rate,
  candle.c * rate,
  candle.v * rate,
  candle.n,
  candle.b,
];
/** A whole amount in a coin's own money, as lamports. */
const inLamports = (amount: bigint, rate: number): bigint => (rate === 1 ? amount : BigInt(Math.round(Number(amount) * rate)));

interface Stats {
  volume: Record<WindowKey, number>;
  buys24h: number;
  sells24h: number;
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

  constructor(private readonly source: ChainSource) {
    this.indexer = new Indexer(
      database(),
      source,
      {
        applied: (block) => this.applied(block),
        early: (_tx, trades) => {
          for (const trade of trades) {
            const rate = this.rateOf(this.indexer.markets.get(trade.mint));
            if (rate !== null) this.hub.publish(`coin:${trade.mint}`, ["e", tradeView(trade, true, rate)]);
          }
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
    if (source instanceof StreamSource && settings().feedScope === "coins") {
      this.refollow();
      this.following = setInterval(() => this.refollow(), REFOLLOW_EVERY_MS);
    }
    this.describer = new Describer(database(), {
      // Coins with no name yet, the most traded in the last hour first.
      waiting: (most, skip) => {
        const now = Math.floor(this.clock() / 1000);
        const unnamed: { mint: string; volume: number }[] = [];
        for (const market of this.indexer.markets.values())
          if (market.name === "" && market.seenFromSlot !== undefined && !market.quote && !this.describer.facts(market.mint) && !skip(market.mint))
            unnamed.push({ mint: market.mint, volume: this.rolling.window(market.mint, WINDOWS.h1, now).volume });
        return unnamed
          .sort((a, b) => b.volume - a.volume)
          .slice(0, most)
          .map((entry) => entry.mint);
      },
      accounts: (keys) => connection().getMultipleAccountsInfo(keys, "confirmed"),
      read: async (mint, described) => {
        const market = this.indexer.markets.get(mint);
        if (!market) return;
        if (market.name === "" && market.seenFromSlot !== undefined) {
          await this.indexer.describe(mint, {
            name: described.name,
            symbol: described.symbol,
            uri: described.uri,
            creator: described.creator || market.creator,
          });
          // Now that it says where its picture is, the picture is fetched.
          this.picture([mint]);
        }
        // A coin in a pump.fun pool that pump.fun did not make has its own supply, not pump.fun's thousand million.
        if (
          !described.facts.pump &&
          !market.venue &&
          described.facts.decimals === 6 &&
          BigInt(described.facts.supply) > 0n &&
          BigInt(described.facts.supply) !== market.supply
        )
          await this.indexer.resupply(mint, BigInt(described.facts.supply));
        // A Mayhem coin's supply is what its mint says now: two thousand million at first, less whatever has been burned since.
        if (described.facts.mayhem && BigInt(described.facts.supply) > 0n && BigInt(described.facts.supply) !== market.supply)
          await this.indexer.resupply(mint, BigInt(described.facts.supply));
        this.touch(mint);
      },
      problem: (error) => log("warn", "coins could not be read from the chain", failure(error)),
    });
    this.indexer.readMeteora = settings().feedVenues.includes("meteora-damm2");
    // About twenty minutes of a public chain. A restart for a deploy is well inside it; a day's stop is not.
    if (settings().network !== "local" && !(source instanceof StreamSource)) this.indexer.skipWhenBehind = 3_000;
    this.poolReader = new PoolReader({
      waiting: (most, skip) => this.indexer.poolsToRead(most, skip),
      accounts: (keys) => connection().getMultipleAccountsInfo(keys, "confirmed"),
      learned: (facts) => this.indexer.learnPool(facts),
      unreadable: (pool) => this.indexer.forgetPool(pool),
      problem: (error) => log("warn", "pools could not be read from the chain", failure(error)),
    });
    // Pictures of the coins the board and rankings show are fetched ahead of anyone asking, newest wanted first.
    this.picturing = setInterval(() => {
      while (pictureRoom() && this.toPicture.length > 0) {
        const mint = this.toPicture.pop()!;
        this.queuedPictures.delete(mint);
        const uri = this.indexer.markets.get(mint)?.uri;
        if (uri && !pictureKept(mint)) void coinImage(mint, uri).catch(() => undefined);
      }
    }, 200);
    this.tidying = setInterval(
      () => void this.tidy().catch((error: unknown) => log("error", "dropping dead coins failed", { error: String(error) })),
      TIDY_EVERY_MS,
    );
  }

  /**
   * With a stream that carries only chosen coins: the coins whose every trade is being received. The rest are known
   * (they were seen being made) and their figures stay as they were when last heard: `view` says since when.
   * Undefined when every coin is live, which is the case for whole blocks and for a full stream.
   */
  private live: Set<string> | undefined;
  private following: ReturnType<typeof setInterval> | undefined;
  /** Chooses the coins to receive every trade of: the ones somebody needs, then the newest, up to the setting. */
  private refollow(): void {
    if (!(this.source instanceof StreamSource)) return;
    const now = Date.now();
    const markets = [...this.indexer.markets.values()].filter((market) => !market.quote);
    const wanted = markets.filter((market) => this.needed(market.mint, now));
    const newest = markets
      .filter((market) => !wanted.includes(market))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, settings().feedFollowNewest);
    const chosen = [...wanted, ...newest];
    const before = this.live;
    this.live = new Set(chosen.map((market) => market.mint));
    // A coin trades at its curve's address until it graduates, and at its pool's after.
    this.source.follow(chosen.map((market) => market.pool ?? curveAddress(market.mint).toBase58()));
    // A coin that has just stopped or started being live says so on the board.
    for (const market of markets) if ((before?.has(market.mint) ?? true) !== this.live.has(market.mint)) this.touch(market.mint);
  }
  /** How much of the chain is being received, for the board to say. */
  coverage(): { scope: "all" | "coins"; live: number; followed: number } {
    return { scope: this.live ? "coins" : "all", live: this.live?.size ?? this.indexer.markets.size, followed: this.indexer.markets.size };
  }
  /** What the feed is doing, for /health. */
  feed(): Record<string, unknown> {
    const { feedProvider, feedScope } = settings();
    const stream = this.source instanceof StreamSource ? this.source : undefined;
    return {
      provider: stream ? feedProvider : "rpc",
      scope: stream ? feedScope : "all",
      ...(stream ? { down: stream.down, late: stream.late, repeats: stream.repeats, gaps: stream.gaps } : {}),
      followedLive: this.live?.size ?? this.indexer.markets.size,
      followed: this.indexer.markets.size,
      venues: settings().feedVenues,
      ...(this.indexer.skipped ? { skippedSlots: this.indexer.skipped } : {}),
      poolReadCalls: this.poolReader.calls,
      pictures: { ...pictureStats, waiting: this.toPicture.length },
      describeCalls: this.describer.calls,
      describeWaiting: this.describer.waitingFor,
    };
  }

  private readonly toPicture: string[] = [];
  private readonly queuedPictures = new Set<string>();
  private readonly picturing: ReturnType<typeof setInterval>;
  /** Asks for coins' pictures to be fetched into this server's cache, without waiting for them. The last named are fetched first. */
  private picture(mints: Iterable<string>): void {
    for (const mint of mints) {
      if (this.queuedPictures.has(mint) || !this.indexer.markets.get(mint)?.uri) continue;
      if (this.toPicture.length >= 5_000) this.queuedPictures.delete(this.toPicture.shift()!);
      this.toPicture.push(mint);
      this.queuedPictures.add(mint);
    }
  }
  readonly describer: Describer;
  readonly poolReader: PoolReader;
  private readonly rolling = new Rolling();
  /**
   * What time it is, for everything measured in "the last hour". The real time, except when a recording is being
   * played back, where it is the time of the recording's newest block: its last hour is the hour before that.
   */
  clock: () => number = () => Date.now();

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
  async tidy(now = this.clock()): Promise<number> {
    // A coin other coins are priced in stays followed while any of them is: without it they have no price.
    const pricing = new Set<string>();
    for (const market of this.indexer.markets.values()) if (market.pricedIn) pricing.add(market.pricedIn);
    const gone = coinsToDrop(this.indexer.markets.values(), now, (mint) => pricing.has(mint) || this.needed(mint, now));
    if (gone.length === 0) return 0;
    await this.indexer.drop(gone);
    for (const mint of gone) {
      this.sent.delete(mint);
      this.rolling.drop(mint);
      this.risks.delete(mint);
      this.dirty.delete(mint);
      this.asked.delete(mint);
      this.hub.publish("board", ["x", mint]);
    }
    await this.describer.forget(gone);
    log("info", "stopped following quiet coins", { dropped: gone.length, followed: this.indexer.markets.size });
    return gone.length;
  }

  private applied(block: Applied): void {
    for (const trade of block.trades) {
      // Without a price of SOL a USDC trade cannot be put beside SOL ones: it is stored, and neither counted nor sent, until there is one.
      const rate = this.rateOf(this.indexer.markets.get(trade.mint));
      if (rate === null) continue;
      this.rolling.add(trade.mint, Math.floor(trade.at / 1000), Number(trade.sol) * rate, trade.isBuy);
      const wire = ["t", tradeView(trade, false, rate)];
      this.hub.publish(`coin:${trade.mint}`, wire);
      this.hub.publish(`wallet:${trade.wallet}`, wire);
    }
    for (const { mint, tf, candle } of block.candles) {
      const rate = this.rateOf(this.indexer.markets.get(mint));
      if (rate !== null) this.hub.publish(`k:${mint}:${tf}`, ["k", candleWire(candle, rate)]);
    }
    // What the page shows of a wallet is read again after anything that moved its coins or its SOL.
    for (const trade of block.trades) forgetBalances(trade.wallet);
    for (const holder of block.holders) {
      forgetBalances(holder.owner);
      this.hub.publish(`coin:${holder.mint}`, ["h", holder.owner, holder.amount.toString()]);
      this.hub.publish(`wallet:${holder.owner}`, ["b", holder.mint, holder.amount.toString()]);
    }
    for (const market of block.markets) {
      // A coin not seen before: the board's kept answer is out of date at once, not in a second.
      if (!this.sent.has(market.mint)) this.boardKept = undefined;
      this.dirty.add(market.mint);
    }
    this.patchTimer ??= setTimeout(() => void this.patch(), PATCH_MS);
    for (const listener of this.onApplied) listener(block);
  }

  /**
   * What one unit of a coin's own money is worth in lamports: 1 for a coin priced in SOL; for one priced in USDC,
   * the lamports a millionth of a USDC buys at the price of SOL now. Null when it cannot be said: a coin priced in
   * anything else, or no price of SOL to hand.
   */
  rateOf(market: Market | undefined): number | null {
    if (!market?.quote) return 1;
    if (market.quote !== USDC) return null;
    const price = knownSolPrice();
    return price ? 1000 / price.usd : null;
  }

  /** Has a coin's current figures sent out again: after its past has been filled in. */
  touch(mint: string): void {
    this.boardKept = undefined;
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
    const now = Math.floor(this.clock() / 1000);
    const price = Number(priceOf(market.virtualSol, market.virtualTokens));
    const day = this.rolling.window(market.mint, WINDOWS.h24, now);
    return {
      buys24h: day.buys,
      sells24h: day.trades - day.buys,
      volume24h: day.volume,
      volume: {
        m5: this.rolling.window(market.mint, WINDOWS.m5, now).volume,
        h1: this.rolling.window(market.mint, WINDOWS.h1, now).volume,
        h6: this.rolling.window(market.mint, WINDOWS.h6, now).volume,
        h24: day.volume,
      },
      change: {
        m5: changeBps(priceAt(minutes, now - 300), price),
        h1: changeBps(priceAt(minutes, now - 3600), price),
        h24: changeBps(priceAt(fives, now - 86_400), price),
      },
    };
  }

  /**
   * The coins that traded most in a window, most first, as the board shows them. Kept for two seconds: a ranking
   * does not need to be worked out for every caller.
   */
  private readonly trends = new Map<WindowKey, { at: number; value: Promise<CoinView[]> }>();
  trending(window: WindowKey): Promise<CoinView[]> {
    const kept = this.trends.get(window);
    if (kept && Date.now() - kept.at < 2_000) return kept.value;
    const top = this.rolling.top(WINDOWS[window], Math.floor(this.clock() / 1000), TRENDING_SHOWN);
    // The top of the list is fetched first.
    this.picture(top.map((entry) => entry.mint).reverse());
    const value = Promise.all(top.map(({ mint }) => this.view(mint))).then((views) => views.filter((view): view is CoinView => view !== undefined));
    this.trends.set(window, { at: Date.now(), value });
    return value;
  }
  /**
   * Fills the by-the-minute record from the stored one-minute candles of the last day, once, when the server starts:
   * without it, "volume in 24 hours" would count only from the restart.
   */
  async warm(): Promise<void> {
    const since = Math.floor(this.clock() / 1000) - WINDOWS.h24;
    const rows = await database().query<{ mint: string; t: number; vol_sol: string; n: number; buys: number; quote: string | null }>(
      "select c.mint, c.t, c.vol_sol::text, c.n, c.buys, m.quote from candles c join markets m on m.mint = c.mint where c.tf = 60 and c.t > $1",
      [since],
    );
    const usdc = this.rateOf({ quote: USDC } as Market);
    for (const row of rows) {
      const rate = row.quote === null ? 1 : row.quote === USDC ? usdc : null;
      if (rate !== null) this.rolling.add(row.mint, Number(row.t), Number(row.vol_sol) * rate, false, row.n, row.buys);
    }
  }

  /** A coin's risk figures, worked out again at most every few seconds however often the coin trades. */
  private readonly risks = new Map<string, { at: number; trades: number; value: Promise<Risk> }>();
  private risk(market: Market): Promise<Risk> {
    const kept = this.risks.get(market.mint);
    const now = Date.now();
    // Nothing has traded since: the figures cannot have changed. Otherwise they are good for a few seconds.
    if (kept && (kept.trades === market.trades || now - kept.at < RISK_GOOD_FOR_MS)) return kept.value;
    const value = riskOf(database(), market, [curveAddress(market.mint).toBase58(), MAYHEM_VAULT, DAMM2_AUTHORITY, ...(market.pool ? [market.pool] : [])]);
    this.risks.set(market.mint, { at: now, trades: market.trades, value });
    value.catch(() => this.risks.delete(market.mint));
    return value;
  }

  /** Everything shown about one coin, from memory. Undefined if the indexer does not follow it. */
  async view(mint: string): Promise<CoinView | undefined> {
    const market = this.indexer.markets.get(mint);
    if (!market) return undefined;
    const listed = state().coins.find((coin) => coin.mint === mint);
    const stats = await this.stats(market);
    const facts = this.describer.facts(mint);
    // Null: this coin's money cannot be turned into lamports, so no figure in money is shown for it at all.
    const rate = this.rateOf(market);
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
      // A coin not launched here: this server's own small copy of its picture, fetched when first asked for (lib/server/coin-image.ts).
      // A coin launched here without a picture has none.
      ...(listed ? (listed.image ? { image: listed.image } : {}) : market.uri ? { image: `/coin-image/${mint}` } : {}),
      launchedHere: listed !== undefined,
      ...(market.seenFromSlot === undefined ? {} : { followedSince: market.createdAt }),
      ...(rate === null
        ? { unsupported: { reason: "quote" as const, quote: market.quote ?? "" } }
        : // A coin in a pump.fun pool that is not pump.fun's, with other than six decimals: its trades were stored as if it had six.
          facts && !market.venue && !facts.pump && facts.decimals !== 6
          ? { unsupported: { reason: "foreign" as const } }
          : {}),
      ...(facts && !market.venue && !facts.pump && facts.decimals === 6 ? { foreign: true as const } : {}),
      ...(!market.venue && (facts?.mayhem || market.supply > ONE_BILLION_COINS) ? { mayhem: true as const } : {}),
      ...(market.venue ? { venue: "meteora-damm2" as const } : {}),
      // Only a graduation this server saw. A coin first seen in its pool graduated at some earlier time nobody here knows.
      ...(market.completedAt !== undefined && market.completedAt !== market.createdAt ? { graduatedAt: market.completedAt } : {}),
      ...(this.live && !this.live.has(mint) && !market.quote ? { notLiveSince: market.lastTradeAt ?? market.createdAt } : {}),
      ...(market.quote === USDC && rate !== null ? { quote: "USDC" as const } : {}),
      ...(market.pricedIn ? { pricedIn: { mint: market.pricedIn, symbol: this.indexer.markets.get(market.pricedIn)?.symbol ?? "" } } : {}),
      marketCapLamports: inLamports(marketCapOf(market), rate ?? 1).toString(),
      microLamportsPerCoin: inLamports(priceOf(market.virtualSol, market.virtualTokens), rate ?? 1).toString(),
      changeBasisPoints: stats.change.h24 ?? 0,
      changeSince: Math.max(market.createdAt, this.clock() - 86_400_000),
      change: stats.change,
      volume24hLamports: String(stats.volume24h),
      volumeLamports: { m5: String(stats.volume.m5), h1: String(stats.volume.h1), h6: String(stats.volume.h6), h24: String(stats.volume.h24) },
      liquidityLamports: inLamports(market.realSol, rate ?? 1).toString(),
      buys24h: stats.buys24h,
      sells24h: stats.sells24h,
      ...(rate === null ? {} : { risk: await this.risk(market) }),
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

  /**
   * What the board opens on: the newest coins, the ones nearest to graduating, the latest to graduate and the most
   * traded in the last hour, so each column has its rows whichever coins happen to be busiest this second.
   * `seq` is the board channel's number as of this answer; the channel keeps the board up to date from there.
   */
  private boardKept: { at: number; value: Promise<{ coins: CoinView[]; seq: number; recordFrom: number | null }> } | undefined;
  board(): Promise<{ coins: CoinView[]; seq: number; recordFrom: number | null }> {
    if (this.boardKept && Date.now() - this.boardKept.at < 1_000) return this.boardKept.value;
    const seq = this.hub.seq("board");
    const all = [...this.indexer.markets.values()];
    const chosen = new Set<string>();
    const take = (markets: Market[]): void => {
      for (const market of markets.slice(0, BOARD_EACH)) chosen.add(market.mint);
    };
    take(all.filter((market) => market.seenFromSlot === undefined).sort((a, b) => b.createdAt - a.createdAt));
    take(
      all
        .filter((market) => !market.complete)
        .map((market) => ({ market, progress: progressOf(market) }))
        .filter((entry) => entry.progress >= NEARLY_BPS)
        .sort((a, b) => b.progress - a.progress)
        .map((entry) => entry.market),
    );
    take(all.filter((market) => market.complete).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)));
    for (const { mint } of this.rolling.top(WINDOWS.h1, Math.floor(this.clock() / 1000), BOARD_EACH)) chosen.add(mint);
    this.picture(chosen);
    const value = Promise.all([this.recordFrom(), ...[...chosen].map((mint) => this.view(mint))]).then(([recordFrom, ...views]) => {
      const coins = views.filter((view): view is CoinView => view !== undefined);
      for (const view of coins) if (!this.sent.has(view.mint)) this.sent.set(view.mint, view);
      return { coins: coins.sort((a, b) => b.createdAt - a.createdAt), seq, recordFrom };
    });
    this.boardKept = { at: Date.now(), value };
    value.catch(() => (this.boardKept = undefined));
    return value;
  }

  /** Coins whose name or ticker holds the text, best match first, among every coin followed. */
  async search(text: string): Promise<CoinView[]> {
    const wanted = text.trim().toLowerCase();
    if (wanted.length === 0) return [];
    const now = Math.floor(this.clock() / 1000);
    const found: { mint: string; rank: number; volume: number }[] = [];
    for (const market of this.indexer.markets.values()) {
      const symbol = market.symbol.toLowerCase();
      const name = market.name.toLowerCase();
      const rank =
        symbol === wanted
          ? 0
          : name === wanted
            ? 1
            : symbol.startsWith(wanted)
              ? 2
              : name.startsWith(wanted)
                ? 3
                : symbol.includes(wanted) || name.includes(wanted)
                  ? 4
                  : -1;
      if (rank >= 0) found.push({ mint: market.mint, rank, volume: 0 });
    }
    for (const entry of found) entry.volume = this.rolling.window(entry.mint, WINDOWS.h24, now).volume;
    found.sort((a, b) => a.rank - b.rank || b.volume - a.volume);
    const views = await Promise.all(found.slice(0, SEARCH_SHOWN).map((entry) => this.view(entry.mint)));
    return views.filter((view): view is CoinView => view !== undefined);
  }

  /** The wallets that traded a coin, ranked by what they took out less what they put in, counting what they still hold at the price now. */
  async traders(market: Market, escrow: string | null): Promise<TraderView[]> {
    const db = database();
    const [rows, held] = await Promise.all([
      db.query<{ wallet: string; bought: string; sold: string; coins_in: string; coins_out: string; n: number; first: string }>(
        `select wallet, sum(case when is_buy then sol else 0 end)::text as bought, sum(case when is_buy then 0 else sol end)::text as sold,
                sum(case when is_buy then tokens else 0 end)::text as coins_in, sum(case when is_buy then 0 else tokens end)::text as coins_out,
                count(*)::int as n, min(at)::text as first
         from trades where mint = $1 group by wallet order by sum(sol) desc limit 5000`,
        [market.mint],
      ),
      db.query<{ owner: string; amount: string }>("select owner, amount::text from holders where mint = $1 and amount > 0", [market.mint]),
    ]);
    const holding = new Map(held.map((row) => [row.owner, BigInt(row.amount)]));
    const rate = this.rateOf(market) ?? 1;
    const price = priceOf(market.virtualSol, market.virtualTokens);
    const ranked = rows.map((row) => {
      const holds = holding.get(row.wallet) ?? 0n;
      // Price is millionths of a lamport for one whole coin; a whole coin is a million base units.
      const made = BigInt(row.sold) - BigInt(row.bought) + (holds * price) / 1_000_000_000_000n;
      return { row, holds, made };
    });
    ranked.sort((a, b) => (b.made > a.made ? 1 : b.made < a.made ? -1 : 0));
    return ranked.slice(0, TRADERS_SHOWN).map(({ row, holds }) => ({
      wallet: row.wallet,
      boughtLamports: inLamports(BigInt(row.bought), rate).toString(),
      soldLamports: inLamports(BigInt(row.sold), rate).toString(),
      boughtCoins: row.coins_in,
      soldCoins: row.coins_out,
      holding: holds.toString(),
      trades: row.n,
      firstAt: Number(row.first),
      tags: this.tagsOf(market, row.wallet, escrow),
    }));
  }

  private recordFromKept: { at: number; value: Promise<number | null> } | undefined;
  /** When the oldest trade held here happened. Asked of the database at most every ten minutes, once there is an answer. */
  private recordFrom(): Promise<number | null> {
    if (!this.recordFromKept || Date.now() - this.recordFromKept.at > 600_000) {
      const value = database()
        .query<{ first: string | null }>("select min(at)::text as first from trades")
        .then((rows) => (rows[0]?.first ? Number(rows[0].first) : null));
      this.recordFromKept = { at: Date.now(), value };
      // "Nothing held yet" is not kept: the first trade may arrive any moment.
      void value.then(
        (found) => found === null && (this.recordFromKept = undefined),
        () => (this.recordFromKept = undefined),
      );
    }
    return this.recordFromKept.value;
  }
  /** Whether a coin's pool liquidity can be pulled out. Read from the chain at most once a minute per coin. */
  private readonly liquidities = new Map<string, { at: number; pool: string | undefined; value: Promise<LiquidityCheck> }>();
  private liquidity(market: Market): Promise<LiquidityCheck> {
    const kept = this.liquidities.get(market.mint);
    if (kept && kept.pool === market.pool && Date.now() - kept.at < 60_000) return kept.value;
    const value = liquidityOf(market, (keys) => connection().getMultipleAccountsInfo(keys, "confirmed"));
    if (this.liquidities.size > 5_000) this.liquidities.clear();
    this.liquidities.set(market.mint, { at: Date.now(), pool: market.pool, value });
    return value;
  }
  /** A coin's safety facts from the chain, its creator's other coins here, and how far back its trades go. */
  async checks(market: Market): Promise<ChecksView> {
    let facts: ChecksView["facts"] = null;
    let factsProblem: string | undefined;
    try {
      facts = (await this.describer.now(market.mint)) ?? null;
      if (!facts) factsProblem = "the chain holds no coin account at this address that this site can read";
    } catch (error) {
      factsProblem = error instanceof Error ? error.message : String(error);
    }
    const others = market.creator
      ? [...this.indexer.markets.values()]
          .filter((other) => other.creator === market.creator && other.mint !== market.mint)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, DEV_COINS_SHOWN)
      : [];
    const liquidity = await this.liquidity(market);
    const [first, recordFrom] = await Promise.all([
      database().query<{ first: string | null }>("select min(at)::text as first from trades where mint = $1", [market.mint]),
      this.recordFrom(),
    ]);
    return {
      liquidity,
      facts,
      ...(factsProblem ? { factsProblem } : {}),
      dev: {
        creator: market.creator,
        coins: others.map((other) => ({
          mint: other.mint,
          name: other.name,
          symbol: other.symbol,
          createdAt: other.createdAt,
          complete: other.complete,
          marketCapLamports: inLamports(marketCapOf(other), this.rateOf(other) ?? 0).toString(),
        })),
      },
      history: { from: first[0]?.first ? Number(first[0].first) : null, complete: market.seenFromSlot === undefined, limit: HISTORY_LIMIT },
      recordFrom,
    };
  }

  /** The labels a holder's address carries: the curve, the pool, the creator, the Ring's stand-in. */
  tagsOf(market: Market, owner: string, escrow: string | null): string[] {
    const tags: string[] = [];
    if (owner === curveAddress(market.mint).toBase58()) tags.push("curve");
    if (owner === MAYHEM_VAULT) tags.push("mayhem");
    if (owner === DAMM2_AUTHORITY) tags.push("pool");
    if (owner === market.creator) tags.push("creator");
    if (escrow !== null && owner === escrow) tags.push("ring");
    return tags;
  }

  async stop(): Promise<void> {
    clearTimeout(this.patchTimer);
    clearInterval(this.tidying);
    clearInterval(this.following);
    clearInterval(this.picturing);
    this.describer.stop();
    this.poolReader.stop();
    if (this.source instanceof StreamSource) this.source.close();
    await this.indexer.stop();
  }
}

/**
 * Where the indexer's data comes from, by the settings. Changing provider or scope is a change of settings:
 *   FEED_PROVIDER=rpc         whole blocks over the RPC (the local chain, devnet)
 *   FEED_PROVIDER=helius-ws   Helius's transaction stream; FEED_SCOPE=coins for the cheapest plan, all for everything
 */
function sourceFromSettings(): ChainSource {
  const { feedProvider, feedScope, feedVenues, heliusApiKey, network } = settings();
  if (feedProvider === "rpc") return new RpcSource(connection);
  if (!heliusApiKey) throw new Error("FEED_PROVIDER is helius-ws but HELIUS_API_KEY is not set");
  if (network === "local") throw new Error("FEED_PROVIDER helius-ws needs RING_NETWORK devnet or mainnet: there is no Helius stream of a local chain");
  return new StreamSource(
    new HeliusTxStream({
      socketUrl: `wss://${network}.helius-rpc.com/?api-key=${heliusApiKey}`,
      rpc: connection,
      // Everything: the two programs. The cheapest plan: only what makes a coin, plus the coins chosen to be followed.
      // Other programs' pools are followed only with everything, and only when FEED_VENUES asks for them: each is more to carry.
      always: feedScope === "all" ? [PUMP_PROGRAM, AMM_PROGRAM, ...(feedVenues.includes("meteora-damm2") ? [DAMM2_PROGRAM] : [])] : [PUMP_MINT_AUTHORITY],
    }),
  );
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
      const made = new MarketService(sourceFor ? sourceFor() : sourceFromSettings());
      await made.warm();
      await made.describer.start();
      made.poolReader.start();
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
