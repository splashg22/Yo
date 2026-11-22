/** This site's own fee: off unless set, exact when set, shown in every answer, and paid in the same transaction. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NATIVE } from "../../lib/constants";
import type { RingClient } from "../../lib/sdk";
import { settings } from "../../lib/server/env";
import { SOL, call, expectCovered, freshServer, fundedClient, onChain } from "./helpers";

freshServer();
let creator: RingClient, trader: RingClient, treasury: RingClient, mint: string;
const off = (): void => {
  for (const name of ["FEE_WALLET", "FEE_TRADE_BPS", "FEE_LAUNCH_LAMPORTS", "FEE_OTC_BPS"]) delete process.env[name];
};
beforeAll(async () => {
  off();
  [creator, trader, treasury] = await Promise.all([fundedClient(), fundedClient(), fundedClient()]);
  mint = (await creator.launch({ name: "Fee", symbol: "FEE", firstBuyLamports: SOL / 10n })).mint;
});
afterAll(off);

describe("this site's fee", () => {
  it("is off unless it is set: nothing is charged and the config says so", async () => {
    expect((await call("config")).fees).toEqual({ wallet: "", tradeBps: 0, launchLamports: "0", otcBps: 0 });
    const before = await onChain(treasury.address, NATIVE);
    const built = await call("trade/build", { wallet: trader.address, mint, side: "buy", amount: (SOL / 10n).toString() });
    expect(built.feeLamports).toBe("0");
    await trader.trade(mint, "buy", SOL / 10n);
    expect(await onChain(treasury.address, NATIVE)).toBe(before);
  });

  it("refuses settings that make no sense, at the door", () => {
    process.env.FEE_TRADE_BPS = "50";
    expect(() => settings()).toThrow(/FEE_WALLET is not a wallet address/);
    process.env.FEE_WALLET = treasury.address;
    expect(settings().fees.tradeBps).toBe(50);
    for (const wrong of ["301", "-1", "0.5", "half"]) {
      process.env.FEE_TRADE_BPS = wrong;
      expect(() => settings()).toThrow(/FEE_TRADE_BPS must be a whole number from 0 to 300/);
    }
    process.env.FEE_TRADE_BPS = "0";
    process.env.FEE_LAUNCH_LAMPORTS = "a lot";
    expect(() => settings()).toThrow(/FEE_LAUNCH_LAMPORTS must be a whole number/);
    off();
  });

  it("takes exactly its share of a buy and of a sell, in the same transaction, and says how much beforehand", async () => {
    process.env.FEE_WALLET = treasury.address;
    process.env.FEE_TRADE_BPS = "50"; // half a percent
    expect((await call("config")).fees).toMatchObject({ wallet: treasury.address, tradeBps: 50 });

    const before = await onChain(treasury.address, NATIVE);
    // A tenth of a SOL: the local curve sells out below one SOL, so the trades here stay small.
    const built = await call("trade/build", { wallet: trader.address, mint, side: "buy", amount: (SOL / 10n).toString() });
    expect(built.feeLamports).toBe((SOL / 2000n).toString());
    const bought = await trader.trade(mint, "buy", SOL / 10n);
    expect((await onChain(treasury.address, NATIVE)) - before).toBe(SOL / 2000n);

    const quoted = await call("trade/build", { wallet: trader.address, mint, side: "sell", amount: (bought.expected / 2n).toString() });
    const mid = await onChain(treasury.address, NATIVE);
    const sold = await trader.trade(mint, "sell", bought.expected / 2n);
    // The fee on a sell is a share of what the sale was expected to fetch when it was built.
    expect((await onChain(treasury.address, NATIVE)) - mid).toBe((sold.expected * 50n) / 10_000n);
    expect(BigInt(quoted.feeLamports)).toBeGreaterThan(0n);
    off();
  });

  it("charges a launch its flat fee, plus the trade share of a first buy", async () => {
    process.env.FEE_WALLET = treasury.address;
    process.env.FEE_LAUNCH_LAMPORTS = "20000000";
    process.env.FEE_TRADE_BPS = "100";
    const before = await onChain(treasury.address, NATIVE);
    await creator.launch({ name: "Paid", symbol: "PAID", firstBuyLamports: SOL / 10n });
    expect((await onChain(treasury.address, NATIVE)) - before).toBe(20_000_000n + SOL / 1000n);
    off();
  });

  it("charges an OTC buyer on top of the price, into the fee wallet's Ring balance, or moves nothing at all", async () => {
    await trader.register();
    await creator.register();
    const block = 1_000_000n;
    await trader.deposit(mint, block * 2n);
    await creator.deposit(NATIVE, SOL);
    process.env.FEE_WALLET = treasury.address;
    process.env.FEE_OTC_BPS = "25"; // a quarter of a percent
    const price = SOL / 2n;
    const first = await trader.offer({ buyer: creator.address, mint, amount: block, priceLamports: price });
    const [sellerSol, buyerSol] = [await trader.ringBalance(NATIVE), await creator.ringBalance(NATIVE)];
    const settled = await creator.acceptOffer(first.id);
    expect(settled.offer.feeLamports).toBe(((price * 25n) / 10_000n).toString());
    expect(await trader.ringBalance(NATIVE)).toBe(sellerSol + price); // the seller receives the whole price
    expect(await creator.ringBalance(NATIVE)).toBe(buyerSol - price - (price * 25n) / 10_000n);
    expect(await treasury.ringBalance(NATIVE)).toBe((price * 25n) / 10_000n);
    await expectCovered(NATIVE);

    // A buyer who can cover the price but not the fee pays neither, and keeps the offer open.
    const exact = await creator.ringBalance(NATIVE);
    const second = await trader.offer({ buyer: creator.address, mint, amount: block, priceLamports: exact });
    await expect(creator.acceptOffer(second.id)).rejects.toThrow(/does not cover the price and this site's fee/);
    expect(await creator.ringBalance(NATIVE)).toBe(exact);
    expect(await creator.ringBalance(mint)).toBe(block);
    off();
  });
});
