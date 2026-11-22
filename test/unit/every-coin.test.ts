/**
 * The board's server side on a stretch of real mainnet (the 50 recorded blocks): every coin that trades is followed,
 * and the ranking, the search, the top traders and the "how far back" answer are each checked against what the
 * recording itself holds. The server is in mainnet mode throughout, which is read-only.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NEARLY_BPS } from "../../lib/board-filters";
import { RecordedSource } from "../../lib/server/indexer/recorded-source";
import { market, useSource, type MarketService } from "../../lib/server/market";
import { database, forget, ready } from "../../lib/server/store";

const RECORDING = join(__dirname, "..", "fixtures", "mainnet-472395011-50.jsonl.gz");
const NAMES = ["APP_DATA_DIR", "RING_NETWORK", "FEED_SCOPE", "FEED_PROVIDER", "MAINNET_RPC_URL", "LOG_SILENT", "APP_STORE"] as const;
const previous = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
let service: MarketService;
let lastTime = 0;

beforeAll(async () => {
  Object.assign(process.env, {
    APP_DATA_DIR: mkdtempSync(join(tmpdir(), "ring-every-")),
    RING_NETWORK: "mainnet",
    FEED_SCOPE: "all",
    FEED_PROVIDER: "rpc",
    // Nothing answers here: the test shows what the page is told when the chain cannot be asked.
    MAINNET_RPC_URL: "http://127.0.0.1:9",
    LOG_SILENT: "1",
  });
  delete process.env.APP_STORE;
  forget();
  await ready();
  const source = new RecordedSource(RECORDING);
  lastTime = source.times().at(-1)! * 1000;
  source.release(1);
  useSource(() => source);
  service = await market();
  service.clock = () => lastTime;
  await service.indexer.reached(source.release(1000));
}, 60_000);
afterAll(async () => {
  await service.stop();
  useSource(undefined);
  forget();
  for (const name of NAMES) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
});

const volumes = async (): Promise<{ mint: string; volume: number }[]> =>
  (await database().query<{ mint: string; volume: string }>("select mint, sum(sol)::text as volume from trades group by mint order by sum(sol) desc")).map(
    (row) => ({
      mint: row.mint,
      volume: Number(row.volume),
    }),
  );

describe("every coin that trades, on a recorded stretch of mainnet", () => {
  it("follows coins it never saw being made, and says so of each", async () => {
    const all = [...service.indexer.markets.values()];
    const seenPartWay = all.filter((market) => market.seenFromSlot !== undefined);
    // The recording makes four coins. Everything else on the board was already trading.
    expect(all.length).toBeGreaterThan(100);
    expect(all.length - seenPartWay.length).toBeLessThanOrEqual(4);
    const view = (await service.view(seenPartWay[0]!.mint))!;
    expect(view.followedSince).toBeDefined();
    expect(view.name).toBe("");
  });

  it("ranks coins by what they traded, exactly as the stored trades add up", async () => {
    const want = await volumes();
    const trending = await service.trending("m5");
    expect(trending.length).toBeGreaterThan(20);
    // The whole recording is inside five minutes of its own last block, so the ranking is the ranking of everything stored.
    expect(trending.slice(0, 10).map((coin) => coin.mint)).toEqual(want.slice(0, 10).map((row) => row.mint));
    expect(Number(trending[0]!.volumeLamports.m5)).toBe(want[0]!.volume);
    for (let at = 1; at < trending.length; at++)
      expect(Number(trending[at]!.volumeLamports.m5)).toBeLessThanOrEqual(Number(trending[at - 1]!.volumeLamports.m5));
    // Buys and sells on a row are counted from the same trades.
    const counted = await database().query<{ buys: number; sells: number }>(
      "select count(*) filter (where is_buy)::int as buys, count(*) filter (where not is_buy)::int as sells from trades where mint = $1",
      [trending[0]!.mint],
    );
    expect([trending[0]!.buys24h, trending[0]!.sells24h]).toEqual([counted[0]!.buys, counted[0]!.sells]);
  });

  it("opens the board on each kind of coin: the newest, the nearest to graduating, the graduated, the most traded", async () => {
    const { coins } = await service.board();
    expect(new Set(coins.map((coin) => coin.mint)).size).toBe(coins.length);
    const made = [...service.indexer.markets.values()].filter((market) => market.seenFromSlot === undefined);
    for (const market of made)
      expect(
        coins.some((coin) => coin.mint === market.mint),
        market.mint,
      ).toBe(true);
    expect(coins.some((coin) => coin.complete)).toBe(true);
    expect(coins.some((coin) => !coin.complete && coin.progressBps >= NEARLY_BPS)).toBe(true);
    const top = (await service.trending("h1"))[0]!;
    expect(coins.some((coin) => coin.mint === top.mint)).toBe(true);
  });

  it("shows a coin priced in something other than SOL as not supported, with no trades read into it", async () => {
    const other = [...service.indexer.markets.values()].find((market) => market.quote);
    expect(other).toBeDefined();
    const view = (await service.view(other!.mint))!;
    expect(view.unsupported).toEqual({ reason: "quote", quote: other!.quote });
    expect(view.trades).toBe(0);
    expect(view.risk).toBeUndefined();
  });

  it("finds a coin by name, by ticker and by address among everything followed", async () => {
    const named = [...service.indexer.markets.values()].find((market) => market.name.length > 3 && market.symbol.length > 1 && !market.quote)!;
    expect(named).toBeDefined();
    expect((await service.search(named.symbol.toUpperCase())).map((coin) => coin.mint)).toContain(named.mint);
    expect((await service.search(named.name.slice(0, 4).toLowerCase())).map((coin) => coin.mint)).toContain(named.mint);
    expect(await service.search("no coin is called this, surely")).toEqual([]);
    expect(await service.search("   ")).toEqual([]);
  });

  it("lists a coin's traders by what they made, adding up to the trades stored", async () => {
    const busiest = (await volumes())[0]!;
    const found = service.indexer.markets.get(busiest.mint)!;
    const traders = await service.traders(found, null);
    expect(traders.length).toBeGreaterThan(3);
    const made = (trader: (typeof traders)[number]): bigint =>
      BigInt(trader.soldLamports) -
      BigInt(trader.boughtLamports) +
      (BigInt(trader.holding) * BigInt((found.virtualSol * 1_000_000_000_000n) / found.virtualTokens)) / 1_000_000_000_000n;
    for (let at = 1; at < traders.length; at++) expect(made(traders[at]!) <= made(traders[at - 1]!)).toBe(true);
    const rows = await database().query<{ wallet: string; n: number; bought: string }>(
      "select wallet, count(*)::int as n, sum(case when is_buy then sol else 0 end)::text as bought from trades where mint = $1 group by wallet",
      [busiest.mint],
    );
    for (const trader of traders) {
      const row = rows.find((entry) => entry.wallet === trader.wallet)!;
      expect([trader.trades, trader.boughtLamports]).toEqual([row.n, row.bought]);
    }
  });

  it("says how far back a coin's trades go, and does not pass off an unread check as passed", async () => {
    const partWay = [...service.indexer.markets.values()].find((market) => market.seenFromSlot !== undefined && market.trades > 2)!;
    const checks = await service.checks(partWay);
    const first = await database().query<{ first: string }>("select min(at)::text as first from trades where mint = $1", [partWay.mint]);
    expect(checks.history).toEqual({ from: Number(first[0]!.first), complete: false, limit: 5_000 });
    // The chain could not be asked here: the facts are absent and the reason is given, not a default.
    expect(checks.facts).toBeNull();
    expect(checks.factsProblem).toBeTruthy();
    expect(checks.recordFrom).toBeLessThanOrEqual(Number(first[0]!.first));

    const whole = [...service.indexer.markets.values()].find((market) => market.seenFromSlot === undefined && !market.quote)!;
    expect((await service.checks(whole)).history.complete).toBe(true);
  }, 30_000);
});
