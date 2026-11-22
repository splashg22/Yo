/**
 * pump.fun coins priced in something other than SOL, on 30 recorded mainnet blocks. On mainnet these are priced in
 * other coins (other pump.fun coins, mostly). One is given a price in SOL only through a coin that is itself
 * followed and priced; otherwise it is listed and no trade is read into it.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../lib/server/db";
import { Indexer } from "../../lib/server/indexer/indexer";
import { priceOf, type Trade } from "../../lib/server/indexer/model";
import { RecordedSource } from "../../lib/server/indexer/recorded-source";
import { USDC, type TradeEvent } from "../../lib/server/indexer/types";
import { candleWire, tradeView } from "../../lib/server/market";

const RECORDING = join(__dirname, "..", "fixtures", "mainnet-472440444-30.jsonl.gz");
const open: Db[] = [];
const running: Indexer[] = [];
afterEach(async () => {
  for (const indexer of running.splice(0)) await indexer.stop();
  for (const db of open.splice(0)) await db.close();
});

describe("a pump.fun coin priced in another coin", () => {
  it("is named by its trades: what it is priced in, and amounts in that coin's units", () => {
    const events = new RecordedSource(RECORDING).all().flatMap((block) => block.txs.flatMap((tx) => tx.events));
    const quoted = events.filter((event): event is TradeEvent => event.kind === "trade" && event.quoteMint !== undefined);
    expect(quoted.length).toBeGreaterThan(3);
    for (const event of quoted) {
      expect(event.venue).toBe("curve");
      expect(event.sol > 0n && event.virtualSol > 0n && event.tokens > 0n, event.mint).toBe(true);
    }
    // On this stretch of mainnet none is priced in USDC: they are priced in other coins.
    expect(quoted.some((event) => event.quoteMint === USDC)).toBe(false);
  });

  it("gets a price in SOL through the coin it is priced in, when that coin is followed; and is only listed when it is not", async () => {
    const db = await openDb({ databaseUrl: "", databaseSchema: "ringpad", dataDir: mkdtempSync(join(tmpdir(), "ring-quoted-")) });
    open.push(db);
    const source = new RecordedSource(RECORDING);
    const raw = new Map<string, TradeEvent>();
    for (const block of source.all())
      for (const tx of block.txs) for (const event of tx.events) if (event.kind === "trade" && event.quoteMint) raw.set(`${tx.signature}|${event.mint}`, event);
    source.release(1);
    const indexer = new Indexer(db, source, {}, undefined, 200, true);
    await indexer.start();
    running.push(indexer);
    await indexer.reached(source.release(1000));

    const markets = [...indexer.markets.values()];
    const priced = markets.filter((market) => market.pricedIn);
    const listedOnly = markets.filter((market) => market.quote);
    expect(priced.length + listedOnly.length).toBeGreaterThan(1);
    for (const market of listedOnly) expect(market.trades, market.mint).toBe(0);
    for (const market of priced) {
      const other = indexer.markets.get(market.pricedIn!)!;
      // The coin it is priced in is followed, and is itself priced in SOL (or through another such coin).
      expect(other, market.mint).toBeDefined();
      expect(other.quote).toBeUndefined();
      expect(market.quote).toBeUndefined();
      const stored = await db.query<{ signature: string; sol: string; tokens: string; price: string }>(
        "select signature, sol::text, tokens::text, price::text from trades where mint = $1 order by slot, tx_index, idx",
        [market.mint],
      );
      expect(stored.length).toBe(market.trades);
      for (const trade of stored) {
        const event = raw.get(`${trade.signature}|${market.mint}`)!;
        expect(event, trade.signature).toBeDefined();
        // The coins are the event's own. The SOL is the other coin's amount at a price that coin really had in this stretch.
        expect(BigInt(trade.tokens)).toBe(event.tokens);
        const perUnit = Number(trade.sol) / Number(event.sol);
        const prices = (
          await db.query<{ low: string; high: string }>("select min(price)::text as low, max(price)::text as high from trades where mint = $1", [other.mint])
        )[0]!;
        const [low, high] = [Number(prices.low ?? 0) / 1e12, Number(prices.high ?? 0) / 1e12];
        // (A coin that did not trade in the stretch has only the price it was first seen at.)
        const seen = Number(priceOf(other.virtualSol, other.virtualTokens)) / 1e12;
        expect(
          perUnit >= Math.min(low || seen, seen) * 0.999 && perUnit <= Math.max(high, seen) * 1.001,
          `${trade.signature}: ${perUnit} outside ${low}..${high}`,
        ).toBe(true);
      }
    }
  });
});

describe("a coin priced in USDC", () => {
  const trade: Trade = {
    signature: "made-up",
    idx: 0,
    mint: "made-up-coin",
    slot: 1,
    txIndex: 0,
    at: 1_000,
    wallet: "made-up-wallet",
    isBuy: true,
    venue: "curve",
    // 25 USDC for a million coins: 25 millionths of a USDC a coin.
    sol: 25_000_000n,
    tokens: 1_000_000_000_000n,
    price: 25_000_000n,
  };
  it("is sent to the page as lamports at the price of SOL then, so that in dollars it reads as the USDC paid", () => {
    const solUsd = 160;
    const rate = 1000 / solUsd;
    const sent = tradeView(trade, false, rate);
    // The page shows dollars as lamports times the price of SOL.
    expect((sent.sol / 1e9) * solUsd).toBeCloseTo(25, 6);
    // The price of one coin, the same way: millionths of a lamport a coin, to dollars.
    expect((sent.p / 1e6 / 1e9) * solUsd).toBeCloseTo(0.000025, 12);
    expect(sent.tok).toBe(1_000_000_000_000);
    const candle = candleWire({ t: 60, o: 20_000_000, h: 30_000_000, l: 20_000_000, c: 25_000_000, v: 25_000_000, n: 1, b: 1 }, rate);
    expect((candle[4]! / 1e15) * solUsd).toBeCloseTo(0.000025, 12);
    expect((candle[5]! / 1e9) * solUsd).toBeCloseTo(25, 6);
    expect([candle[0], candle[6], candle[7]]).toEqual([60, 1, 1]);
  });
  it("is sent unchanged when the coin is priced in SOL", () => {
    expect(tradeView(trade).sol).toBe(25_000_000);
    expect(candleWire({ t: 60, o: 1, h: 2, l: 1, c: 2, v: 3, n: 1, b: 1 })).toEqual([60, 1, 2, 1, 2, 3, 1, 1]);
  });
});
