/** Which coins stop being followed, and that dropping one leaves nothing of it behind. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../lib/server/db";
import { Indexer } from "../../lib/server/indexer/indexer";
import type { Market } from "../../lib/server/indexer/model";
import { RecordedSource } from "../../lib/server/indexer/recorded-source";
import { DEFAULT_RETENTION, coinsToDrop } from "../../lib/server/indexer/retention";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const SOL = 1_000_000_000n;
const coin = (mint: string, over: Partial<Market>): Market => ({
  mint,
  creator: "c",
  name: mint,
  symbol: mint,
  uri: "",
  createdAt: NOW - 10 * 3_600_000,
  createdSlot: 1,
  supply: 1_000_000_000_000_000n,
  initialRealTokens: 793_100_000_000_000n,
  virtualSol: 30n * SOL,
  virtualTokens: 1_000_000_000_000_000n,
  realSol: 0n,
  realTokens: 793_100_000_000_000n,
  complete: false,
  holders: 0,
  trades: 0,
  ...over,
});
const nobody = (): boolean => false;

describe("which coins stop being followed", () => {
  it("drops a curve coin that never took off after half an hour of quiet, and any curve coin after six hours", () => {
    const markets = [
      coin("fresh", { createdAt: NOW - 5 * MIN }), // just made, no trade yet: kept
      coin("stillborn", { createdAt: NOW - 31 * MIN }), // made, never traded
      coin("tiny-quiet", { lastTradeAt: NOW - 31 * MIN, realSol: SOL / 2n }),
      coin("tiny-busy", { lastTradeAt: NOW - 2 * MIN, realSol: SOL / 2n }),
      coin("real-quiet", { lastTradeAt: NOW - 5 * 3_600_000, realSol: 20n * SOL }),
      coin("real-dead", { lastTradeAt: NOW - 7 * 3_600_000, realSol: 20n * SOL }),
    ];
    expect(coinsToDrop(markets, NOW, nobody).sort()).toEqual(["real-dead", "stillborn", "tiny-quiet"]);
  });

  it("keeps a graduated coin for a day of quiet", () => {
    const markets = [
      coin("pool-quiet", { complete: true, lastTradeAt: NOW - 23 * 3_600_000 }),
      coin("pool-dead", { complete: true, lastTradeAt: NOW - 25 * 3_600_000 }),
    ];
    expect(coinsToDrop(markets, NOW, nobody)).toEqual(["pool-dead"]);
  });

  it("never drops a coin somebody needs, however dead it looks", () => {
    const markets = [coin("ours", { createdAt: NOW - 90 * 24 * 3_600_000 }), coin("theirs", { createdAt: NOW - 90 * 24 * 3_600_000 })];
    expect(coinsToDrop(markets, NOW, (mint) => mint === "ours")).toEqual(["theirs"]);
  });

  it("holds to the ceiling by dropping the quietest of the coins nobody needs", () => {
    const markets = Array.from({ length: 10 }, (_, index) => coin(`c${index}`, { lastTradeAt: NOW - (index + 1) * MIN, realSol: 50n * SOL }));
    const dropped = coinsToDrop(markets, NOW, (mint) => mint === "c9", { ...DEFAULT_RETENTION, ceiling: 7 });
    // Three must go. c9 is the quietest and is needed, so the next three quietest go instead.
    expect(dropped).toEqual(["c8", "c7", "c6"]);
    expect(coinsToDrop(markets, NOW, nobody, { ...DEFAULT_RETENTION, ceiling: 10 })).toEqual([]);
  });
});

describe("coins that were trading before the indexer began to listen", () => {
  const RECORDING = join(__dirname, "..", "fixtures", "mainnet-472395011-50.jsonl.gz");
  const open: Db[] = [];
  const running: Indexer[] = [];
  afterEach(async () => {
    for (const indexer of running.splice(0)) await indexer.stop();
    for (const db of open.splice(0)) await db.close();
  });
  async function replay(discover: boolean): Promise<{ db: Db; indexer: Indexer; source: RecordedSource }> {
    const db = await openDb({ databaseUrl: "", databaseSchema: "ringpad", dataDir: mkdtempSync(join(tmpdir(), "ring-retention-")) });
    open.push(db);
    const source = new RecordedSource(RECORDING);
    source.release(1);
    const indexer = new Indexer(db, source, {}, undefined, 200, discover);
    await indexer.start();
    running.push(indexer);
    await indexer.reached(source.release(1000));
    return { db, indexer, source };
  }

  it("are followed from the first trade seen, on the curve and in a pool, and say that their past is not known", async () => {
    const { db, indexer, source } = await replay(true);
    // What should be stored, worked out here from the decoded blocks: every curve trade, and every pool trade whose
    // transaction shows the pool holding wrapped SOL and a pump.fun coin. (About four pool trades in ten in this
    // recording are of coins not made on pump.fun: the recording does not keep those coins' accounts, and they are not followed.)
    const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
    let wanted = 0;
    for (const block of source.all().slice(1))
      for (const tx of block.txs)
        for (const event of tx.events) {
          if (event.kind !== "trade") continue;
          const pool = event.mint.slice(5);
          const placed =
            // A curve trade priced in another coin is counted apart, below: it is stored only if that coin is followed.
            (event.venue === "curve" && !event.quoteMint) ||
            (tx.balances.some((balance) => balance.owner === pool && balance.mint === WRAPPED_SOL) &&
              tx.balances.some((balance) => balance.owner === pool && balance.mint !== WRAPPED_SOL));
          if (placed) wanted += 1;
        }
    const stored = (await db.query<{ n: number }>("select count(*)::int as n from trades"))[0]!.n;
    expect(wanted).toBeGreaterThan(1000);
    const markets = [...indexer.markets.values()];
    // Trades of coins priced in another coin, each turned into lamports through a coin that is followed here.
    const throughAnother = markets.filter((market) => market.pricedIn).reduce((sum, market) => sum + market.trades, 0);
    expect(throughAnother).toBeGreaterThan(0);
    expect(stored).toBe(wanted + throughAnother);
    expect(markets.length).toBeGreaterThan(100);
    const found = markets.filter((market) => market.seenFromSlot !== undefined);
    const made = markets.filter((market) => market.seenFromSlot === undefined);
    // Coins made during the recording know their name; coins found by a trade do not, and are marked.
    expect(made.filter((market) => !market.quote).every((market) => market.name !== "" && market.creator !== "")).toBe(true);
    expect(found.length).toBeGreaterThan(90);
    // (A coin priced in a coin that is not followed is listed with no trade read into it.)
    expect(found.every((market) => market.name === "" && market.creator === "" && (market.trades > 0 || market.quote !== undefined))).toBe(true);
    // Both kinds of venue were found, and a pool coin's address is a real coin's address, not the pool's.
    const inPools = found.filter((market) => market.pool);
    expect(inPools.length).toBeGreaterThan(20);
    expect(found.filter((market) => !market.pool).length).toBeGreaterThan(20);
    for (const market of inPools) expect(market.mint).not.toBe(market.pool);
    // Their prices are real prices.
    expect(found.every((market) => market.virtualSol > 0n && market.virtualTokens > 0n)).toBe(true);
    // Filled in later, a found coin keeps what was read.
    const one = found[0]!;
    await indexer.describe(one.mint, { name: "Read later", symbol: "LATER", uri: "https://example.invalid/x.json", creator: "someone" });
    expect(indexer.markets.get(one.mint)).toMatchObject({ name: "Read later", symbol: "LATER", creator: "someone" });
    expect((await db.query<{ name: string }>("select name from markets where mint = $1", [one.mint]))[0]!.name).toBe("Read later");
  });

  it("lists a coin priced in something other than SOL, marked as such, and stores none of its trades", async () => {
    const { db, indexer } = await replay(false);
    const other = [...indexer.markets.values()].filter((market) => market.quote);
    expect(other).toHaveLength(1);
    expect(other[0]).toMatchObject({ trades: 0 });
    expect(other[0]!.symbol.length).toBeGreaterThan(0);
    expect((await db.query<{ n: number }>("select count(*)::int as n from trades where mint = $1", [other[0]!.mint]))[0]!.n).toBe(0);
  });

  it("leaves nothing behind when a coin is dropped, and keeps every other coin exactly as it was", async () => {
    const { db, indexer } = await replay(true);
    const all = [...indexer.markets.values()].sort((a, b) => b.trades - a.trades);
    const gone = all.slice(0, 40).map((market) => market.mint);
    const stays = all[40]!.mint;
    const count = async (table: string, mint: string): Promise<number> =>
      (await db.query<{ n: number }>(`select count(*)::int as n from ${table} where mint = $1`, [mint]))[0]!.n;
    const before = { trades: await count("trades", stays), candles: await count("candles", stays), holders: await count("holders", stays) };
    expect(await count("trades", gone[0]!)).toBeGreaterThan(0);
    await indexer.drop(gone);
    for (const mint of gone) {
      expect(indexer.markets.has(mint)).toBe(false);
      for (const table of ["markets", "trades", "candles", "holders", "holder_undo", "market_undo"])
        expect(await count(table, mint), `${table} ${mint}`).toBe(0);
    }
    expect(indexer.markets.size).toBe(all.length - 40);
    expect({ trades: await count("trades", stays), candles: await count("candles", stays), holders: await count("holders", stays) }).toEqual(before);
    // Dropping what is not followed, or dropping twice, does nothing.
    await indexer.drop([...gone, "not-a-coin"]);
    expect(indexer.markets.size).toBe(all.length - 40);
  });
});
