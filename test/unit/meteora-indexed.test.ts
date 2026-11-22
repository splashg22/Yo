/**
 * Meteora DAMM v2 pools through the indexer, on 30 recorded mainnet blocks (22 November 2026). What each pool trades
 * was read from mainnet for this fixture (test/fixtures/damm2-pools-*.json): the same read the server makes, kept
 * so the test needs no chain. Every Meteora trade stored is then held against the chain's own record in the same
 * transaction: what the pool's two coin accounts changed by.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../lib/server/db";
import { Indexer } from "../../lib/server/indexer/indexer";
import { DAMM2_AUTHORITY, DAMM2_PROGRAM, toMillionths, type PoolFacts } from "../../lib/server/indexer/meteora";
import { marketCapOf } from "../../lib/server/indexer/model";
import { RecordedSource } from "../../lib/server/indexer/recorded-source";
import type { RawBlock } from "../../lib/server/indexer/rpc-source";

const RECORDING = join(__dirname, "..", "fixtures", "mainnet-472440444-30.jsonl.gz");
const WSOL = "So11111111111111111111111111111111111111112";
const POOLS: PoolFacts[] = (
  JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "damm2-pools-472440444.json"), "utf8")) as (Omit<PoolFacts, "supply"> & { supply: string })[]
).map((pool) => ({ ...pool, supply: BigInt(pool.supply) }));
const open: Db[] = [];
const running: Indexer[] = [];
afterEach(async () => {
  for (const indexer of running.splice(0)) await indexer.stop();
  for (const db of open.splice(0)) await db.close();
});
async function indexed(options: { meteora: boolean; learn: boolean }): Promise<{ db: Db; indexer: Indexer; source: RecordedSource }> {
  const db = await openDb({ databaseUrl: "", databaseSchema: "ringpad", dataDir: mkdtempSync(join(tmpdir(), "ring-meteora-")) });
  open.push(db);
  const source = new RecordedSource(RECORDING);
  source.release(1);
  const indexer = new Indexer(db, source, {}, undefined, 200, true);
  indexer.readMeteora = options.meteora;
  await indexer.start();
  running.push(indexer);
  if (options.learn) for (const pool of POOLS) await indexer.learnPool(pool);
  await indexer.reached(source.release(1000));
  return { db, indexer, source };
}
/** For each transaction with exactly one Meteora event and two coin accounts of the pools' owner: what those two changed by. */
function chainRecord(): Map<string, Map<string, { delta: bigint }>> {
  const found = new Map<string, Map<string, { delta: bigint }>>();
  const lines = gunzipSync(readFileSync(RECORDING)).toString("utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    for (const tx of (JSON.parse(line) as RawBlock).transactions) {
      const keys = tx.transaction.message.accountKeys;
      const calls = (tx.meta?.innerInstructions ?? []).flatMap((group) => group.instructions).filter((call) => keys[call.programIdIndex] === DAMM2_PROGRAM);
      if (calls.length !== 1) continue;
      const before = new Map((tx.meta?.preTokenBalances ?? []).map((balance) => [balance.accountIndex, BigInt(balance.uiTokenAmount.amount)]));
      const moved = new Map<string, { delta: bigint }>();
      for (const balance of tx.meta?.postTokenBalances ?? [])
        if (balance.owner === DAMM2_AUTHORITY)
          moved.set(balance.mint, { delta: BigInt(balance.uiTokenAmount.amount) - (before.get(balance.accountIndex) ?? 0n) });
      if (moved.size === 2) found.set(tx.transaction.signatures[0]!, moved);
    }
  }
  return found;
}

describe("Meteora DAMM v2 pools, indexed from a recorded stretch of mainnet", () => {
  it("are not read at all unless the settings ask for them", async () => {
    const { db, indexer } = await indexed({ meteora: false, learn: true });
    expect(await db.query("select 1 from trades where venue = 'damm2' limit 1")).toHaveLength(0);
    expect([...indexer.markets.values()].some((market) => market.venue)).toBe(false);
  });

  it("wait to be read from the chain: a pool whose coins are not known has no trade guessed for it", async () => {
    const { db, indexer } = await indexed({ meteora: true, learn: false });
    expect(await db.query("select 1 from trades where venue = 'damm2' limit 1")).toHaveLength(0);
    const waiting = indexer.poolsToRead(1000, () => false);
    expect(new Set(waiting)).toEqual(new Set(POOLS.map((pool) => pool.pool)));
    // Asked for fifty at a time, and a pool lately tried is passed over.
    expect(indexer.poolsToRead(5, () => false)).toHaveLength(5);
    expect(indexer.poolsToRead(1000, (pool) => pool === waiting[0])).not.toContain(waiting[0]);
  });

  it("store every swap as the trade the chain recorded, coin by coin and lamport by lamport", async () => {
    const { db, indexer } = await indexed({ meteora: true, learn: true });
    const facts = new Map(POOLS.map((pool) => [pool.mint, pool]));
    const record = chainRecord();
    const trades = await db.query<{ signature: string; mint: string; is_buy: boolean; sol: string; tokens: string; wallet: string }>(
      "select signature, mint, is_buy, sol::text, tokens::text, wallet from trades where venue = 'damm2'",
    );
    expect(trades.length).toBeGreaterThan(200);
    let checked = 0;
    let exact = 0;
    for (const trade of trades) {
      const moved = record.get(trade.signature);
      const coin = moved?.get(trade.mint);
      const sol = moved?.get(WSOL);
      if (!coin || !sol) continue;
      checked += 1;
      // A buy: the pool gained SOL and gave coins. A sell: the other way.
      expect(trade.is_buy, trade.signature).toBe(sol.delta > 0n);
      // To the unit in nearly every case. Where the pool also paid a referral out of the same account, the pool's
      // change is that much more than what the trader got: the trade is what the trader paid or got.
      const near = (stored: bigint, moved: bigint): boolean => {
        const size = moved > 0n ? moved : -moved;
        const off = stored > size ? stored - size : size - stored;
        if (off === 0n) exact += 1;
        return off * 1000n <= size;
      };
      expect(near(BigInt(trade.sol), sol.delta), trade.signature).toBe(true);
      expect(near(BigInt(trade.tokens), toMillionths(coin.delta > 0n ? coin.delta : -coin.delta, facts.get(trade.mint)!.decimals)), trade.signature).toBe(true);
      expect(trade.wallet.length).toBeGreaterThan(31);
    }
    expect(checked).toBeGreaterThan(150);
    expect(exact / (checked * 2)).toBeGreaterThan(0.9);
    // No trade was read into a pool whose other side is not SOL.
    const notSol = new Set(POOLS.filter((pool) => pool.quote !== WSOL).map((pool) => pool.mint));
    const solToo = new Set(POOLS.filter((pool) => pool.quote === WSOL).map((pool) => pool.mint));
    for (const trade of trades) expect(!notSol.has(trade.mint) || solToo.has(trade.mint), trade.mint).toBe(true);
    expect(indexer.poolsToRead(10, () => false)).toEqual([]);
  });

  it("follow a coin that is not pump.fun's from its pool, with a market cap worked out on its own supply and decimals", async () => {
    const { db, indexer } = await indexed({ meteora: true, learn: true });
    const markets = [...indexer.markets.values()].filter((market) => market.venue === "damm2");
    expect(markets.length).toBeGreaterThan(10);
    for (const market of markets) {
      const pool = POOLS.find((each) => each.pool === market.pool)!;
      expect(pool.quote).toBe(WSOL);
      expect(market.supply).toBe(toMillionths(pool.supply, pool.decimals));
      expect(market.decimals).toBe(pool.decimals === 6 ? undefined : pool.decimals);
      expect(market.seenFromSlot).toBeDefined();
      expect(market.complete).toBe(true);
      // Its last priced trade, at that trade's own price, times the supply: the market cap, to within one trade's movement.
      const last = (
        await db.query<{ sol: string; tokens: string }>(
          "select sol::text, tokens::text from trades where mint = $1 order by slot desc, tx_index desc, idx desc limit 1",
          [market.mint],
        )
      )[0]!;
      const paid = (Number(last.sol) / Number(last.tokens)) * Number(market.supply);
      const cap = Number(marketCapOf(market));
      expect(Math.abs(cap - paid) / paid, market.mint).toBeLessThan(0.2);
      expect(market.realSol).toBeGreaterThan(0n);
    }
    // A coin with nine decimals is held in millionths like the rest: nobody holds more of it than exists.
    const nine = markets.find((market) => market.decimals === 9);
    if (nine) {
      const most = await db.query<{ amount: string }>("select amount::text from holders where mint = $1 order by amount desc limit 1", [nine.mint]);
      expect(BigInt(most[0]?.amount ?? "0") <= nine.supply).toBe(true);
    }
  });

  it("leave a pump.fun coin's price to pump.fun when the coin also trades in a Meteora pool", async () => {
    const { indexer } = await indexed({ meteora: true, learn: true });
    for (const pool of POOLS) {
      const market = indexer.markets.get(pool.mint);
      if (market && !market.venue) expect(market.pool).not.toBe(pool.pool);
    }
  });
});
