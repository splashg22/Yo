/**
 * The indexer against a made-up chain, on the embedded database: order, restarts, reorganisations, candles,
 * holders, and that nothing is ever counted twice.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../lib/server/db";
import { Indexer, type Applied } from "../../lib/server/indexer/indexer";
import { TIMEFRAMES, bucketOf, priceOf } from "../../lib/server/indexer/model";
import { SimChain } from "../../lib/server/indexer/sim-source";
import type { EarlyTx } from "../../lib/server/indexer/types";

const [ana, ben, cal] = ["ana", "ben", "cal"].map((name) => SimChain.wallet(name)) as [string, string, string];
const coin = SimChain.mint("lantern");
const open: Db[] = [];
const newDb = async (): Promise<Db> => {
  const db = await openDb({ databaseUrl: "", databaseSchema: "ringpad", dataDir: mkdtempSync(join(tmpdir(), "ring-indexer-")) });
  open.push(db);
  return db;
};
afterEach(async () => {
  for (const db of open.splice(0)) await db.close();
});

/** Starts an indexer and waits until it has applied everything the chain has. */
async function follow(db: Db, chain: SimChain, events: ConstructorParameters<typeof Indexer>[2] = {}): Promise<Indexer> {
  const indexer = new Indexer(db, chain, events);
  await indexer.start();
  await indexer.reached(await chain.head());
  return indexer;
}
/** Everything the indexer has stored, in a fixed order, to compare two databases. */
async function everything(db: Db) {
  return {
    trades: await db.query(
      "select signature, idx, mint, slot, tx_index, wallet, is_buy, sol::text, tokens::text, price::text from trades order by slot, tx_index, idx",
    ),
    candles: await db.query("select mint, tf, t, o::text, h::text, l::text, c::text, vol_sol::text, n, buys from candles order by mint, tf, t"),
    holders: await db.query("select mint, owner, amount::text from holders where amount > 0 order by mint, owner"),
    markets: await db.query("select mint, virtual_sol::text, virtual_tokens::text, real_tokens::text, complete, holders, trades from markets order by mint"),
  };
}
/** A chain with one coin made in block 1, before the indexer exists: the indexer starts at the present, so it is started first. */
async function started(): Promise<{ chain: SimChain; db: Db; indexer: Indexer }> {
  const chain = new SimChain();
  const db = await newDb();
  const indexer = await follow(db, chain);
  chain.create(coin, ana, "Lantern", "LNT");
  chain.produce();
  await indexer.reached(1);
  return { chain, db, indexer };
}

describe("the indexer", () => {
  it("applies blocks in order and keeps trades, the curve, holders and candles as the chain has them", async () => {
    const { chain, db, indexer } = await started();
    const first = chain.trade(coin, ben, "buy", 1_000_000_000n);
    const second = chain.trade(coin, cal, "buy", 500_000_000n);
    chain.produce();
    const third = chain.trade(coin, ben, "sell", first.tokens / 2n);
    chain.produce(3); // three empty slots first
    await indexer.reached(await chain.head());

    const market = indexer.markets.get(coin)!;
    expect(market).toMatchObject({ creator: ana, name: "Lantern", trades: 3, complete: false, holders: 3 }); // the curve, ben and cal
    expect([market.virtualSol, market.virtualTokens, market.realTokens]).toEqual([
      chain.curve(coin).virtualSol,
      chain.curve(coin).virtualTokens,
      chain.curve(coin).realTokens,
    ]);
    const trades = await indexer.recent(coin);
    expect(trades.map((trade) => trade.signature)).toEqual([first.signature, second.signature, third.signature]);
    expect(trades.map((trade) => [trade.slot, trade.txIndex, trade.isBuy])).toEqual([
      [2, 0, true],
      [2, 1, true],
      [6, 0, false],
    ]);
    expect(trades[2]!.price).toBe(priceOf(market.virtualSol, market.virtualTokens));
    const holders = await indexer.topHolders(coin, 10);
    expect(Object.fromEntries(holders.map((holder) => [holder.owner, holder.amount]))).toEqual({
      [chain.curveOwner(coin)]: chain.holding(coin, chain.curveOwner(coin)),
      [ben]: first.tokens - first.tokens / 2n,
      [cal]: second.tokens,
    });
    expect(await indexer.flows(ben, coin)).toEqual([
      {
        mint: coin,
        boughtSol: 1_000_000_000n,
        boughtTokens: first.tokens,
        soldSol: third.sol,
        soldTokens: first.tokens / 2n,
        buys: 1,
        sells: 1,
        lastAt: chain.time * 1000,
      },
    ]);
    expect(indexer.cursor).toBe(6);
    expect((await db.query<{ value: string }>("select value from meta where key = 'cursor'"))[0]!.value).toBe("6");
    await indexer.stop();
  });

  it("builds every timeframe's candles from the trades: they open where the last one closed, and a new bucket starts a new candle", async () => {
    const { chain, indexer } = await started();
    chain.time = 1_800_000_030; // 30 s into a minute
    const start = Number(priceOf(chain.curve(coin).virtualSol, chain.curve(coin).virtualTokens));
    chain.trade(coin, ben, "buy", 2_000_000_000n);
    chain.trade(coin, cal, "buy", 1_000_000_000n);
    chain.produce();
    const afterBuys = Number(priceOf(chain.curve(coin).virtualSol, chain.curve(coin).virtualTokens));
    chain.time += 45; // into the next minute, same five minutes
    const sold = chain.trade(coin, ben, "sell", chain.holding(coin, ben));
    chain.produce();
    await indexer.reached(await chain.head());
    const afterSell = Number(priceOf(chain.curve(coin).virtualSol, chain.curve(coin).virtualTokens));

    const minutes = await indexer.candles(coin, 60);
    expect(minutes).toEqual([
      { t: bucketOf(1_800_000_030, 60), o: start, h: afterBuys, l: start, c: afterBuys, v: 3_000_000_000, n: 2, b: 2 },
      { t: bucketOf(1_800_000_075, 60), o: afterBuys, h: afterBuys, l: afterSell, c: afterSell, v: Number(sold.sol), n: 1, b: 0 },
    ]);
    expect(await indexer.candles(coin, 300)).toEqual([
      { t: bucketOf(1_800_000_030, 300), o: start, h: afterBuys, l: start, c: afterSell, v: 3_000_000_000 + Number(sold.sol), n: 3, b: 2 },
    ]);
    expect((await indexer.candles(coin, 1)).map((candle) => candle.t)).toEqual([1_800_000_030, 1_800_000_075]);
    for (const tf of TIMEFRAMES) {
      const candles = await indexer.candles(coin, tf);
      expect(candles.reduce((sum, candle) => sum + candle.n, 0)).toBe(3);
      expect(candles.at(-1)!.c).toBe(afterSell);
      for (const candle of candles) expect(candle.t % tf).toBe(0);
    }
    await indexer.stop();
  });

  it("starts without waiting when it has a lot to catch up on, says how far behind it is, and still ends level and exact", async () => {
    const { chain, db, indexer } = await started();
    await indexer.stop();
    // While it is down the chain moves a long way on.
    for (let block = 0; block < 60; block++) {
      chain.trade(coin, block % 2 ? ben : cal, "buy", 10_000_000n + BigInt(block));
      chain.produce();
    }
    // A chain that takes its time over every block, as a real RPC does.
    const slow = new Proxy(chain, {
      get(target, property, receiver) {
        if (property !== "block") return Reflect.get(target, property, receiver) as unknown;
        return async (slot: number) => {
          await new Promise((resolve) => setTimeout(resolve, 15));
          return target.block(slot);
        };
      },
    });
    const again = new Indexer(db, slow, {}, undefined, 150);
    const began = Date.now();
    await again.start();
    // It came back long before sixty slow blocks could have been read, and knows it is behind.
    expect(Date.now() - began).toBeLessThan(700);
    expect(again.head - again.cursor).toBeGreaterThan(5);
    expect(again.failure).toBeUndefined();
    await again.reached(await chain.head());
    expect(again.markets.get(coin)!.trades).toBe(60);
    expect((await db.query<{ n: number }>("select count(*)::int as n from trades"))[0]!.n).toBe(60);
    // What it ends with is the chain's own state of the coin, to the last unit.
    const curve = chain.curve(coin);
    expect(again.markets.get(coin)).toMatchObject({ virtualSol: curve.virtualSol, virtualTokens: curve.virtualTokens, realTokens: curve.realTokens });
    await again.stop();
  });

  it("carries on from where it stopped after a restart, picks up what happened meanwhile, and counts nothing twice", async () => {
    const { chain, db, indexer } = await started();
    chain.trade(coin, ben, "buy", 1_000_000_000n);
    chain.produce();
    await indexer.reached(2);
    await indexer.stop();
    // While it is down the chain moves on.
    chain.trade(coin, cal, "buy", 700_000_000n);
    chain.produce();
    chain.trade(coin, ben, "buy", 300_000_000n);
    chain.produce();
    const again = await follow(db, chain);
    expect(again.markets.get(coin)!.trades).toBe(3);
    expect((await db.query<{ n: number }>("select count(*)::int as n from trades"))[0]!.n).toBe(3);
    // A second restart with nothing new changes nothing at all.
    const before = await everything(db);
    await again.stop();
    const third = await follow(db, chain);
    expect(await everything(db)).toEqual(before);
    // What it holds is exactly what an indexer that never stopped would hold.
    const freshChain = new SimChain();
    const freshDb = await newDb();
    const never = await follow(freshDb, freshChain);
    freshChain.create(coin, ana, "Lantern", "LNT");
    freshChain.produce();
    freshChain.trade(coin, ben, "buy", 1_000_000_000n);
    freshChain.produce();
    freshChain.trade(coin, cal, "buy", 700_000_000n);
    freshChain.produce();
    freshChain.trade(coin, ben, "buy", 300_000_000n);
    freshChain.produce();
    await never.reached(await freshChain.head());
    const [a, b] = [await everything(db), await everything(freshDb)];
    expect(a.candles).toEqual(b.candles);
    expect(a.holders).toEqual(b.holders);
    expect(a.markets).toEqual(b.markets);
    expect(a.trades.length).toBe(b.trades.length);
    await third.stop();
    await never.stop();
  });

  it("refuses to apply the same block twice: the database itself turns the second one away", async () => {
    const { chain, db, indexer } = await started();
    chain.trade(coin, ben, "buy", 1_000_000_000n);
    const block = chain.produce();
    await indexer.reached(2);
    const before = await everything(db);
    await expect((indexer as unknown as { apply(block: unknown): Promise<void> }).apply(block)).rejects.toThrow(/duplicate|unique/i);
    expect(await everything(db)).toEqual(before);
    expect(indexer.markets.get(coin)!.trades).toBe(1);
    await indexer.stop();
  });

  it("undoes the blocks a reorganisation dropped and applies the ones that replaced them, ending exactly where a clean run would", async () => {
    const { chain, db, indexer } = await started();
    const reorgs: { slot: number; mints: string[] }[] = [];
    const watching = new Indexer(db, chain, {}); // not started: only to show the type; the real one below reports reorgs
    void watching;
    await indexer.stop();
    const live = await follow(db, chain, { reorg: (slot, mints) => reorgs.push({ slot, mints }) });
    const other = SimChain.mint("moth");
    chain.trade(coin, ben, "buy", 1_000_000_000n);
    chain.produce(); // slot 2: stays
    chain.trade(coin, cal, "buy", 2_000_000_000n);
    chain.create(other, cal, "Moth", "MOTH");
    chain.produce(); // slot 3: will be dropped
    chain.time += 61;
    chain.trade(coin, ben, "sell", chain.holding(coin, ben));
    chain.trade(other, ben, "buy", 100_000_000n);
    chain.produce(); // slot 4: will be dropped
    await live.reached(4);
    expect(live.markets.has(other)).toBe(true);
    expect(live.markets.get(coin)!.trades).toBe(3);

    // The chain changes its mind about everything after slot 2.
    chain.forkAt(2);
    chain.time -= 61;
    const kept = chain.trade(coin, ana, "buy", 400_000_000n);
    chain.produce(); // a different slot 3
    chain.transfer(coin, ana, cal, 1_000n);
    chain.produce(); // a different slot 4
    chain.trade(coin, cal, "sell", 1_000n);
    chain.produce(); // slot 5: its parent is not the slot 4 the indexer applied
    await live.reached(5);

    expect(reorgs).toHaveLength(1);
    expect(reorgs[0]!.slot).toBe(2);
    expect(reorgs[0]!.mints.sort()).toEqual([coin, other].sort());
    expect(live.markets.has(other)).toBe(false); // the coin made in a dropped block is gone
    expect((await live.recent(coin)).map((trade) => trade.wallet)).toEqual([ben, ana, cal]);
    expect((await live.recent(coin))[1]!.signature).toBe(kept.signature);
    expect(Object.fromEntries((await live.topHolders(coin, 10)).map((holder) => [holder.owner, holder.amount]))).toEqual({
      [chain.curveOwner(coin)]: chain.holding(coin, chain.curveOwner(coin)),
      [ben]: chain.holding(coin, ben),
      [ana]: chain.holding(coin, ana),
    });
    expect(chain.holding(coin, cal)).toBe(0n);

    // The same final chain, read by an indexer that never saw the dropped branch.
    const clean = new SimChain();
    const cleanDb = await newDb();
    const never = await follow(cleanDb, clean);
    clean.create(coin, ana, "Lantern", "LNT");
    clean.produce();
    clean.trade(coin, ben, "buy", 1_000_000_000n);
    clean.produce();
    clean.trade(coin, ana, "buy", 400_000_000n);
    clean.produce();
    clean.transfer(coin, ana, cal, 1_000n);
    clean.produce();
    clean.trade(coin, cal, "sell", 1_000n);
    clean.produce();
    await never.reached(5);
    const [after, wanted] = [await everything(db), await everything(cleanDb)];
    expect(after.candles).toEqual(wanted.candles);
    expect(after.holders).toEqual(wanted.holders);
    expect(after.markets).toEqual(wanted.markets);
    expect(after.trades.map((trade) => [(trade as { slot: number }).slot, (trade as { sol: string }).sol])).toEqual(
      wanted.trades.map((trade) => [(trade as { slot: number }).slot, (trade as { sol: string }).sol]),
    );
    await live.stop();
    await never.stop();
  });

  it("announces a trade it hears of early, then confirms it once from its block, and stores it once", async () => {
    const chain = new SimChain();
    const db = await newDb();
    const early: EarlyTx[] = [];
    const applied: Applied[] = [];
    const indexer = await follow(db, chain, { early: (tx) => early.push(tx), applied: (block) => applied.push(block) });
    chain.create(coin, ana);
    chain.produce();
    await indexer.reached(1);
    const bought = chain.trade(coin, ben, "buy", 1_000_000_000n); // announced at once, before any block
    expect(early.map((tx) => tx.signature)).toEqual([bought.signature]);
    expect((await db.query<{ n: number }>("select count(*)::int as n from trades"))[0]!.n).toBe(0); // heard, not stored
    chain.produce();
    await indexer.reached(2);
    expect(applied.flatMap((block) => block.trades.map((trade) => trade.signature))).toEqual([bought.signature]);
    expect((await db.query<{ n: number }>("select count(*)::int as n from trades"))[0]!.n).toBe(1);
    expect(indexer.markets.get(coin)!.trades).toBe(1);
    await indexer.stop();
  });

  it("keeps trying while the chain cannot be read, loses nothing, and says so meanwhile", async () => {
    const { chain, indexer } = await started();
    chain.down = true;
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(indexer.failure).toMatch(/fetch failed/);
    chain.down = false;
    chain.trade(coin, ben, "buy", 1_000_000_000n);
    chain.produce();
    await indexer.reached(2);
    expect(indexer.failure).toBeUndefined();
    expect(indexer.markets.get(coin)!.trades).toBe(1);
    await indexer.stop();
  });

  it("marks a coin graduated when its curve sells out", async () => {
    const { chain, indexer } = await started();
    chain.trade(coin, ben, "buy", 200_000_000_000n); // far more than the curve has left to sell
    chain.produce();
    await indexer.reached(2);
    expect(indexer.markets.get(coin)).toMatchObject({ complete: true, realTokens: 0n });
    await indexer.stop();
  });
});
