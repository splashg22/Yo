/**
 * The stream source on recorded mainnet: the same transactions delivered one at a time, as a websocket or gRPC
 * stream delivers them, must leave the indexer with the same trades as reading whole blocks does. Then the ways
 * a real stream misbehaves: repeats, late arrivals, a drop and a reconnect, a drop too long to read back.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../lib/server/db";
import { Indexer } from "../../lib/server/indexer/indexer";
import { RecordedSource } from "../../lib/server/indexer/recorded-source";
import { RecordedTxStream } from "../../lib/server/indexer/recorded-stream";
import { StreamSource } from "../../lib/server/indexer/stream-source";

const RECORDING = join(__dirname, "..", "fixtures", "mainnet-472395011-50.jsonl.gz");
const open: Db[] = [];
const running: Indexer[] = [];
const newDb = async (): Promise<Db> => {
  const db = await openDb({ databaseUrl: "", databaseSchema: "ringpad", dataDir: mkdtempSync(join(tmpdir(), "ring-stream-")) });
  open.push(db);
  return db;
};
afterEach(async () => {
  for (const indexer of running.splice(0)) await indexer.stop();
  for (const db of open.splice(0)) await db.close();
});
/** What was stored, in the order it happened, without the fields a stream cannot know exactly (the place in the block). */
const stored = (db: Db) =>
  db.query<{ key: string }>(
    "select signature || ':' || idx || ' ' || mint || ' ' || wallet || ' ' || is_buy || ' ' || sol::text || ' ' || tokens::text || ' ' || price::text as key from trades order by signature, idx",
  );
const reserves = (db: Db) => db.query("select mint, virtual_sol::text, virtual_tokens::text, complete, trades from markets order by mint");

/** The reference: the recording read as whole blocks, every coin followed from the first trade seen. */
async function fromBlocks(): Promise<Db> {
  const db = await newDb();
  const source = new RecordedSource(RECORDING);
  const indexer = new Indexer(db, source, {}, undefined, 200, true);
  await indexer.start();
  running.push(indexer);
  await indexer.reached(source.release(1000));
  return db;
}
async function fromStream(): Promise<{ db: Db; stream: RecordedTxStream; source: StreamSource; indexer: Indexer; finish: () => Promise<void> }> {
  const db = await newDb();
  const stream = new RecordedTxStream(RECORDING);
  const source = new StreamSource(stream);
  stream.connect();
  await source.settled();
  const indexer = new Indexer(db, source, {}, undefined, 200, true);
  await indexer.start();
  running.push(indexer);
  const finish = async (): Promise<void> => {
    await source.settled();
    source.flush();
    await indexer.reached(await source.head());
  };
  return { db, stream, source, indexer, finish };
}

describe("the chain as a stream of transactions", () => {
  it("leaves the same trades and the same prices as reading whole blocks", async () => {
    const blocks = await fromBlocks();
    const { db, stream, source, finish } = await fromStream();
    while (!stream.finished) stream.play(3);
    await finish();
    const [want, got] = [await stored(blocks), await stored(db)];
    // The block reader starts after the recording's first block; the stream has no such first block to skip.
    const wanted = new Set(want.map((row) => row.key));
    expect(want.length).toBeGreaterThan(1000);
    expect(got.filter((row) => wanted.has(row.key))).toHaveLength(want.length);
    expect(got.length).toBeLessThan(want.length + 80);
    expect(source.late).toBe(0);
    expect(source.repeats).toBe(0);
    expect(source.gaps).toBe(0);
  });

  it("takes a transaction once however often it is delivered", async () => {
    const clean = await fromStream();
    while (!clean.stream.finished) clean.stream.play(5);
    await clean.finish();
    const noisy = await fromStream();
    while (!noisy.stream.finished) noisy.stream.play(5, { repeatEvery: 3 });
    await noisy.finish();
    expect(noisy.source.repeats).toBeGreaterThan(500);
    expect(await stored(noisy.db)).toEqual(await stored(clean.db));
    expect(await reserves(noisy.db)).toEqual(await reserves(clean.db));
  });

  it("stores a transaction that arrives after its slot was closed, once, and counts it as late", async () => {
    const clean = await fromStream();
    while (!clean.stream.finished) clean.stream.play(5);
    await clean.finish();
    const { db, stream, source, indexer, finish } = await fromStream();
    // Every twentieth transaction of the first ten blocks is held back...
    const held = stream.play(10, { holdBack: (_tx, index) => index % 20 === 7 });
    expect(held.length).toBeGreaterThan(10);
    // ...the chain moves well past them, and their slots are closed and read...
    stream.play(10);
    await indexer.reached(await source.head());
    // ...and then they turn up.
    stream.deliver(held);
    while (!stream.finished) stream.play(5);
    await finish();
    expect(source.late).toBe(held.length);
    // Nothing lost, nothing twice. (Prices of the coins they belong to are compared as sets of trades, not in order.)
    expect((await stored(db)).map((row) => row.key)).toEqual((await stored(clean.db)).map((row) => row.key));
  });

  it("says it is down when the stream drops, and after a reconnect has everything that was missed, in order", async () => {
    const clean = await fromStream();
    while (!clean.stream.finished) clean.stream.play(5);
    await clean.finish();
    const { db, stream, source, indexer, finish } = await fromStream();
    stream.play(12);
    stream.drop();
    expect(source.down).toBe(true);
    await expect(source.head()).rejects.toThrow(/stream is down/);
    // The indexer notices: its failure is what the pages turn into "live data paused".
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(indexer.failure).toMatch(/stream is down/);
    // Fifteen blocks go by unseen.
    stream.play(15);
    stream.connect();
    await source.settled();
    expect(source.down).toBe(false);
    while (!stream.finished) stream.play(5);
    await finish();
    expect(indexer.failure).toBeUndefined();
    expect(source.gaps).toBe(0);
    expect(source.late).toBe(0);
    expect(await stored(db)).toEqual(await stored(clean.db));
    expect(await reserves(db)).toEqual(await reserves(clean.db));
  });

  it("counts a gap, and loses only the oldest part, when more was missed than can be read back", async () => {
    const clean = await fromStream();
    while (!clean.stream.finished) clean.stream.play(5);
    await clean.finish();
    const { db, stream, source, finish } = await fromStream();
    stream.play(10);
    stream.drop();
    stream.play(20);
    stream.backfillLimit = 300;
    stream.connect();
    await source.settled();
    while (!stream.finished) stream.play(5);
    await finish();
    expect(source.gaps).toBe(1);
    const [all, got] = [(await stored(clean.db)).map((row) => row.key), new Set((await stored(db)).map((row) => row.key))];
    const lost = all.filter((key) => !got.has(key));
    expect(lost.length).toBeGreaterThan(0);
    expect(got.size + lost.length).toBe(all.length);
  });
});
