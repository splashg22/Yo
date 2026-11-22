/** The risk figures against a launch built to exercise each rule, with the answers worked out by hand from the made-up chain. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../lib/server/db";
import { Indexer } from "../../lib/server/indexer/indexer";
import { SimChain } from "../../lib/server/indexer/sim-source";
import { BUNDLE_WALLETS, SNIPE_SLOTS, riskOf } from "../../lib/server/risk";

const wallet = (name: string): string => SimChain.wallet(name);
const [dev, b1, b2, b3, quick, quicker, late, given] = ["dev", "b1", "b2", "b3", "quick", "quicker", "late", "given"].map(wallet) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const coin = SimChain.mint("launch");
const SOL = 1_000_000_000n;
const open: Db[] = [];
const running: Indexer[] = [];
afterEach(async () => {
  for (const indexer of running.splice(0)) await indexer.stop();
  for (const db of open.splice(0)) await db.close();
});
async function launched(): Promise<{ chain: SimChain; db: Db; indexer: Indexer }> {
  const db = await openDb({ databaseUrl: "", databaseSchema: "ringpad", dataDir: mkdtempSync(join(tmpdir(), "ring-risk-")) });
  open.push(db);
  const chain = new SimChain();
  const indexer = new Indexer(db, chain);
  await indexer.start();
  running.push(indexer);
  // The creation slot: the creator's own first buy, and three other wallets buying beside it.
  chain.create(coin, dev, "Launch", "LNCH");
  chain.trade(coin, dev, "buy", SOL);
  for (const buyer of [b1, b2, b3]) chain.trade(coin, buyer, "buy", SOL / 2n);
  chain.produce();
  // One slot later, and one after that: a single wallet each.
  chain.trade(coin, quick, "buy", SOL / 4n);
  chain.produce();
  chain.trade(coin, quicker, "buy", SOL / 4n);
  chain.produce();
  // The fourth slot: too late to be a snipe.
  chain.trade(coin, late, "buy", SOL / 4n);
  chain.produce();
  await indexer.reached(await chain.head());
  return { chain, db, indexer };
}
const bps = (chain: SimChain, ...owners: string[]): number =>
  Number((owners.reduce((sum, owner) => sum + chain.holding(coin, owner), 0n) * 10_000n) / 1_000_000_000_000_000n);

describe("a coin's risk figures", () => {
  it("counts as snipers the wallets that bought within the first slots, the creator apart, and what they still hold", async () => {
    const { chain, db, indexer } = await launched();
    expect(SNIPE_SLOTS).toBe(3);
    const risk = await riskOf(db, indexer.markets.get(coin)!, [chain.curveOwner(coin)]);
    expect(risk.snipers).toEqual({ wallets: 5, heldBps: bps(chain, b1, b2, b3, quick, quicker) });
    // One of them sells out: still a sniper, holding nothing.
    chain.trade(coin, quick, "sell", chain.holding(coin, quick));
    await indexer.reached(chain.produce().slot);
    const after = await riskOf(db, indexer.markets.get(coin)!, [chain.curveOwner(coin)]);
    expect(after.snipers).toEqual({ wallets: 5, heldBps: bps(chain, b1, b2, b3, quicker) });
  });

  it("counts as a bundle the early buyers who bought in a slot with three or more different wallets", async () => {
    const { chain, db, indexer } = await launched();
    expect(BUNDLE_WALLETS).toBe(3);
    const risk = await riskOf(db, indexer.markets.get(coin)!, [chain.curveOwner(coin)]);
    // The three beside the creator in the creation slot. The two who bought alone in their slots are snipers, not a bundle.
    expect(risk.bundles).toEqual({ wallets: 3, heldBps: bps(chain, b1, b2, b3) });
  });

  it("counts as insiders the wallets that hold the coin and never bought it", async () => {
    const { chain, db, indexer } = await launched();
    expect((await riskOf(db, indexer.markets.get(coin)!, [chain.curveOwner(coin)])).insiders).toEqual({ wallets: 0, heldBps: 0 });
    chain.transfer(coin, b1, given, chain.holding(coin, b1) / 2n);
    await indexer.reached(chain.produce().slot);
    const risk = await riskOf(db, indexer.markets.get(coin)!, [chain.curveOwner(coin)]);
    expect(risk.insiders).toEqual({ wallets: 1, heldBps: bps(chain, given) });
    // Being sent coins by the creator does not make the creator an insider of their own coin.
    expect(risk.devBps).toBe(bps(chain, dev));
  });

  it("gives the creator's holding and sales, and the ten largest holders without the curve", async () => {
    const { chain, db, indexer } = await launched();
    const before = await riskOf(db, indexer.markets.get(coin)!, [chain.curveOwner(coin)]);
    expect(before).toMatchObject({ devBps: bps(chain, dev), devSells: 0 });
    // Seven wallets hold the coin: all of them are in the ten largest. The curve, which holds most of the supply, is not.
    expect(before.top10Bps).toBe(bps(chain, dev, b1, b2, b3, quick, quicker, late));
    expect(before.top10Bps).toBeLessThan(5_000);
    chain.trade(coin, dev, "sell", chain.holding(coin, dev) / 2n);
    chain.trade(coin, dev, "sell", 1_000_000n);
    await indexer.reached(chain.produce().slot);
    expect(await riskOf(db, indexer.markets.get(coin)!, [chain.curveOwner(coin)])).toMatchObject({ devBps: bps(chain, dev), devSells: 2 });
  });

  it("says the launch figures are not known for a coin that was already trading when first seen", async () => {
    const { chain, db, indexer } = await launched();
    const market = { ...indexer.markets.get(coin)!, seenFromSlot: 4, creator: "" };
    const risk = await riskOf(db, market, [chain.curveOwner(coin)]);
    expect(risk).toMatchObject({ snipers: null, bundles: null, insiders: null, devBps: 0 });
    // What does not depend on the launch is still given.
    expect(risk.top10Bps).toBeGreaterThan(0);
  });
});
