/**
 * After the curve: a coin that sells out graduates, gets its pool, and trades there, all on the real programs.
 * And a pump.fun coin this server has never seen is followed from its address, with its past.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { NATIVE } from "../../lib/constants";
import type { RingClient } from "../../lib/sdk";
import { rpcCallTotal } from "../../lib/server/solana";
import { SOL, call, chain, freshServer, fundedClient, onChain } from "./helpers";
import { PublicKey } from "@solana/web3.js";

freshServer();
let creator: RingClient, whale: RingClient, trader: RingClient, mint: string;
beforeAll(async () => {
  [creator, whale, trader] = await Promise.all([fundedClient(), fundedClient(), fundedClient()]);
  // The local faucet gives 10 SOL; selling out a curve takes more than that with fees left over for later.
  await chain.confirmTransaction(await chain.requestAirdrop(new PublicKey(whale.address), Number(100n * SOL)), "confirmed");
  mint = (await creator.launch({ name: "Graduate", symbol: "GRAD" })).mint;
});

describe("graduation", () => {
  it("shows how far along the curve a coin is, and marks it graduated when the curve sells out", async () => {
    await trader.trade(mint, "buy", SOL / 10n);
    const early = await call("coin", { mint });
    expect(early.complete).toBe(false);
    expect(early.progressBps).toBeGreaterThan(0);
    expect(early.progressBps).toBeLessThan(10_000);
    await whale.trade(mint, "buy", 50n * SOL); // far more than the curve has left: it takes what it can sell
    const done = await call("coin", { mint });
    expect(done).toMatchObject({ complete: true, progressBps: 10_000, hasPool: false });
  });

  it("refuses to trade a sold-out coin until its pool exists, and says why", async () => {
    await expect(trader.trade(mint, "buy", SOL / 100n)).rejects.toThrow(/pool has not been made yet/);
    await expect(call("graduate/build", { wallet: trader.address, mint: (await creator.launch({ name: "Young", symbol: "YNG" })).mint })).rejects.toThrow(
      /has not sold out yet/,
    );
  });

  it("lets anyone make the pool, once, and then trades the coin there", async () => {
    await trader.graduate(mint);
    const pooled = await call("coin", { mint });
    expect(pooled).toMatchObject({ complete: true, hasPool: true });
    await expect(call("graduate/build", { wallet: trader.address, mint })).rejects.toThrow(/already been made/);

    const [coinsBefore, solBefore] = [await onChain(trader.address, mint), await onChain(trader.address, NATIVE)];
    const bought = await trader.trade(mint, "buy", SOL / 10n);
    const coinsAfter = await onChain(trader.address, mint);
    expect(coinsAfter - coinsBefore).toBe(bought.expected);
    expect(solBefore - (await onChain(trader.address, NATIVE))).toBeGreaterThan(SOL / 10n);
    const sold = await trader.trade(mint, "sell", bought.expected / 2n);
    expect(await onChain(trader.address, mint)).toBe(coinsAfter - bought.expected / 2n);
    expect(sold.expected).toBeGreaterThan(0n);

    // The indexer has both pool trades, marked as such, and the price moved with them.
    const trades = (await call("coin/trades", { mint })).trades;
    expect(trades.slice(0, 2).map((trade) => [trade.s, trade.v, trade.b])).toEqual([
      [sold.signature, "a", 0],
      [bought.signature, "a", 1],
    ]);
    expect(trades[1]).toMatchObject({ w: trader.address, tok: Number(bought.expected) });
    expect(BigInt((await call("coin", { mint })).microLamportsPerCoin)).toBe(BigInt(trades[0]!.p));
    expect(trades[1]!.p).toBeGreaterThan(trades[0]!.p); // the buy lifted the price, the sell lowered it
    const position = (await call("position", { wallet: trader.address, mint })).position!;
    expect(BigInt(position.held)).toBe(await onChain(trader.address, mint));
    expect(position.sells).toBe(1);
  });

  it("builds a pool trade with at most two calls to the chain once the pool's settings are warm", async () => {
    await call("trade/build", { wallet: trader.address, mint, side: "buy", amount: "1000000" });
    const before = rpcCallTotal();
    await call("trade/build", { wallet: trader.address, mint, side: "buy", amount: "2000000" });
    expect(rpcCallTotal() - before).toBeLessThanOrEqual(2);
  });
});

describe("a pump.fun coin this server has never seen", () => {
  it("is followed from its address, with its name, its past trades, candles and largest holders, and live from then on", async () => {
    const stranger = (await creator.launch({ name: "Stranger", symbol: "STR", firstBuyLamports: SOL / 20n })).mint;
    const first = await trader.trade(stranger, "buy", SOL / 10n);
    const second = await trader.trade(stranger, "sell", first.expected / 4n);
    const priceThen = (await call("coin", { mint: stranger })).microLamportsPerCoin;

    // A different server: an empty database, an indexer that starts at the present. It has never heard of the coin.
    freshServer();
    expect((await call("explore")).coins).toEqual([]);
    const adopted = await call("coin", { mint: stranger });
    expect(adopted).toMatchObject({
      name: "Stranger",
      symbol: "STR",
      launchedHere: false,
      creator: creator.address,
      trades: 3,
      microLamportsPerCoin: priceThen,
    });
    const trades = (await call("coin/trades", { mint: stranger })).trades;
    expect(trades.map((trade) => trade.s).slice(0, 2)).toEqual([second.signature, first.signature]);
    expect(trades).toHaveLength(3); // the first buy inside the launch, then the two above
    const day = (await call("coin/candles", { mint: stranger, tf: 86400 })).candles;
    expect(day.reduce((sum, candle) => sum + candle[6]!, 0)).toBe(3);
    expect(day.at(-1)![4]).toBe(Number(priceThen));
    const holders = (await call("coin/holders", { mint: stranger })).holders;
    expect(holders.find((holder) => holder.owner === trader.address)!.amount).toBe((await onChain(trader.address, stranger)).toString());
    expect(holders.some((holder) => holder.tags.includes("curve"))).toBe(true);
    expect((await call("explore")).coins.map((coin) => coin.mint)).toEqual([stranger]);

    // From here it is followed like any other coin.
    const third = await trader.trade(stranger, "buy", SOL / 20n);
    const after = (await call("coin/trades", { mint: stranger })).trades;
    expect(after[0]!.s).toBe(third.signature);
    expect(after).toHaveLength(4);
    expect((await call("coin", { mint: stranger })).trades).toBe(4);
  });

  it("says plainly when an address is not a pump.fun coin, and does not ask the chain again for a minute", async () => {
    const nothing = (await fundedClient()).address;
    await expect(call("coin", { mint: nothing })).rejects.toThrow(/not a pump\.fun coin on this chain/);
    const before = rpcCallTotal();
    await expect(call("coin/trades", { mint: nothing })).rejects.toThrow(/not a pump\.fun coin on this chain/);
    expect(rpcCallTotal() - before).toBe(0);
  });
});
