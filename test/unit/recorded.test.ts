/**
 * The data layer against a stretch of real mainnet: 50 consecutive blocks recorded on 22 November 2026 (slots 472,395,011 onwards)
 * (scripts/record-chain.ts), played back through the same indexer and live hub the server runs.
 * What is proven here is proven on real shapes and real volume: about a hundred trades a second.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../lib/server/db";
import { Indexer } from "../../lib/server/indexer/indexer";
import { RecordedSource } from "../../lib/server/indexer/recorded-source";
import type { ChainBlock, ChainEvent } from "../../lib/server/indexer/types";
import { Hub, type LiveClient } from "../../lib/server/live";

const RECORDING = join(__dirname, "..", "fixtures", "mainnet-472395011-50.jsonl.gz");
const open: Db[] = [];
const running: Indexer[] = [];
const newDb = async (): Promise<Db> => {
  const db = await openDb({ databaseUrl: "", databaseSchema: "ringpad", dataDir: mkdtempSync(join(tmpdir(), "ring-recorded-")) });
  open.push(db);
  return db;
};
afterEach(async () => {
  for (const indexer of running.splice(0)) await indexer.stop();
  for (const db of open.splice(0)) await db.close();
});

/** What the recording holds, worked out here from the decoded blocks alone: the answer the indexer must reach. */
function expected(blocks: ChainBlock[]) {
  // The indexer follows a coin from the block it is created in. Coins older than the recording are not followed by it.
  // It starts at the recording's first block, so what it follows begins with the second.
  const followed = new Set<string>();
  let trades = 0;
  const events: ChainEvent[] = blocks.slice(1).flatMap((block) => block.txs.flatMap((tx) => tx.events));
  for (const event of events) {
    if (event.kind === "create") followed.add(event.mint);
    else if (event.kind === "trade" && followed.has(event.mint)) trades += 1;
  }
  return { coins: followed.size, trades };
}
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
/** An indexer on a source whose first block is already out, so it starts at the recording's beginning. */
async function start(db: Db, source: RecordedSource, events: ConstructorParameters<typeof Indexer>[2] = {}): Promise<Indexer> {
  if (source.tip < source.firstSlot) source.release(1);
  const indexer = new Indexer(db, source, events, undefined, 200);
  await indexer.start();
  running.push(indexer);
  return indexer;
}

describe("a stretch of real mainnet, recorded", () => {
  it("decodes to what was on the chain: pump.fun's curve trades, pool trades and new coins", () => {
    const source = new RecordedSource(RECORDING);
    const blocks = source.all();
    const count = (test: (event: ChainEvent) => boolean): number => blocks.flatMap((block) => block.txs.flatMap((tx) => tx.events)).filter(test).length;
    expect(blocks).toHaveLength(50);
    // Counted once from the recording, apart from the code under test. Curve trades priced in something other than
    // SOL are in the recording too and are left out on purpose (lib/server/indexer/decode.ts), not read as free.
    expect(count((event) => event.kind === "trade" && event.venue === "curve")).toBe(495);
    expect(count((event) => event.kind === "trade" && event.venue === "amm")).toBe(1406);
    // Four new coins: three priced in SOL, and one priced in something else, passed on with that said.
    expect(count((event) => event.kind === "create")).toBe(4);
    expect(count((event) => event.kind === "create" && event.quoteMint !== undefined)).toBe(1);
    // Real blocks join up: each names the one before it, across skipped slots.
    for (let at = 1; at < blocks.length; at++) expect(blocks[at]!.parentHash).toBe(blocks[at - 1]!.hash);
    // Every trade is a real one: amounts above zero, reserves that give a price, a wallet and a coin.
    for (const block of blocks)
      for (const tx of block.txs)
        for (const event of tx.events)
          if (event.kind === "trade") {
            expect(event.sol > 0n && event.tokens > 0n && event.virtualSol > 0n && event.virtualTokens > 0n, tx.signature).toBe(true);
            expect(event.wallet.length).toBeGreaterThan(31);
          }
  });

  it("is indexed block by block into the same state as all at once, with every trade stored once", async () => {
    const want = expected(new RecordedSource(RECORDING).all());
    expect(want.coins).toBeGreaterThan(1);
    expect(want.trades).toBeGreaterThan(3);

    const steady = new RecordedSource(RECORDING);
    const steadyDb = await newDb();
    const one = await start(steadyDb, steady);
    while (!steady.finished) await one.reached(steady.release(1));

    const burst = new RecordedSource(RECORDING);
    const burstDb = await newDb();
    const two = await start(burstDb, burst);
    await two.reached(burst.release(1000));

    const [a, b] = [await everything(steadyDb), await everything(burstDb)];
    expect(a).toEqual(b);
    expect(a.markets).toHaveLength(want.coins);
    expect(a.trades).toHaveLength(want.trades);
    expect(new Set(a.trades.map((row) => `${(row as { signature: string }).signature}:${(row as { idx: number }).idx}`)).size).toBe(a.trades.length);
  });

  it("loses nothing and repeats nothing when the stream drops, the server restarts, and the stream comes back", async () => {
    const clean = new RecordedSource(RECORDING);
    const cleanDb = await newDb();
    const reference = await start(cleanDb, clean);
    await reference.reached(clean.release(1000));

    const source = new RecordedSource(RECORDING);
    const db = await newDb();
    const first = await start(db, source);
    await first.reached(source.release(12));
    // The stream goes quiet: the chain moves on, and nothing reaches the indexer.
    source.down = true;
    source.release(9);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(first.failure).toBeDefined();
    expect(first.cursor).toBeLessThan(source.tip);
    // The server is restarted while the stream is still down, and more of the chain goes by.
    await first.stop();
    running.splice(running.indexOf(first), 1);
    source.release(11);
    const second = await start(db, source);
    expect(second.failure).toBeDefined();
    // The stream comes back. Everything missed is read, in order, and the rest follows.
    source.down = false;
    await second.reached(source.release(1000));
    expect(second.failure).toBeUndefined();
    expect(await everything(db)).toEqual(await everything(cleanDb));
  });

  it("announces each trade once ahead of its block and stores it once", async () => {
    const source = new RecordedSource(RECORDING);
    source.announce = true;
    const early = new Map<string, number>();
    const db = await newDb();
    const indexer = await start(db, source, {
      early: (tx) => early.set(tx.signature, (early.get(tx.signature) ?? 0) + 1),
    });
    // One block at a time: a coin made in one block is known by the time the next block's trades are heard.
    while (!source.finished) await indexer.reached(source.release(1));
    const stored = await db.query<{ signature: string }>("select distinct signature from trades");
    expect(stored.length).toBeGreaterThan(0);
    for (const count of early.values()) expect(count).toBe(1);
    // Everything stored had been announced first, but for one kind: a trade in the very block that creates its coin
    // (the creator's own first buy, and whoever sniped it in the same block). The coin is not known until that
    // block is read, so those trades arrive with the block.
    const creating = new Set(
      source
        .all()
        .filter((block) => block.txs.some((tx) => tx.events.some((event) => event.kind === "create")))
        .flatMap((block) => block.txs.map((tx) => tx.signature)),
    );
    expect(early.size).toBeGreaterThan(0);
    for (const row of stored) expect(early.has(row.signature) || creating.has(row.signature), row.signature).toBe(true);
  });

  it("gives a client that dropped and came back exactly what it missed: no trade twice, none left out", async () => {
    const source = new RecordedSource(RECORDING);
    const hub = new Hub();
    const db = await newDb();
    const indexer = await start(db, source, {
      applied: (block) => {
        for (const trade of block.trades) hub.publish("trades", `${trade.signature}:${trade.idx}`);
        hub.flush();
      },
    });
    /** A client that remembers the last frame number it was sent, as the browser's does. */
    const seen: string[] = [];
    let lastSeq = 0;
    let resets = 0;
    const client = (): LiveClient => ({
      send(text) {
        const frame = JSON.parse(text) as { seq?: number; d?: string[]; reset?: boolean };
        if (typeof frame.seq === "number") lastSeq = frame.seq;
        if (frame.reset) resets += 1;
        for (const item of frame.d ?? []) seen.push(item);
        return true;
      },
      close: () => undefined,
    });
    let connected = client();
    hub.subscribe(connected, "trades", 0);
    await indexer.reached(source.release(15));
    // The connection drops. Fourteen blocks of trades go by with nobody listening.
    hub.leave(connected);
    await indexer.reached(source.release(14));
    const missedFrom = seen.length;
    // It comes back and says where it had got to.
    connected = client();
    hub.subscribe(connected, "trades", lastSeq);
    expect(seen.length).toBeGreaterThan(missedFrom); // the backfill arrived at once
    await indexer.reached(source.release(1000));
    const stored = await db.query<{ key: string }>("select signature || ':' || idx as key from trades order by slot, tx_index, idx");
    expect(resets).toBe(0);
    expect(seen).toEqual(stored.map((row) => row.key));
  });

  it("keeps up: twenty seconds of mainnet's pump.fun activity is indexed in well under twenty seconds", async () => {
    const source = new RecordedSource(RECORDING);
    const db = await newDb();
    const indexer = await start(db, source);
    const began = performance.now();
    await indexer.reached(source.release(1000));
    const took = performance.now() - began;
    // 50 slots are about 20 seconds of chain time. A tenth of that leaves room for a slower machine and a busier day.
    expect(took).toBeLessThan(5_000);
  });
});
