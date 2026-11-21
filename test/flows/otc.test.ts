/** OTC: a block to a named buyer, both legs together or neither. */
import { beforeAll, describe, expect, it } from "vitest";
import { NATIVE } from "../../lib/constants";
import { newActor } from "../../lib/keys";
import { RingClient } from "../../lib/sdk";
import { state } from "../../lib/server/store";
import { SOL, call, expectCovered, freshServer, fundedClient, restartServer } from "./helpers";

freshServer();
let seller: RingClient, buyer: RingClient, mint: string;
beforeAll(async () => {
  [seller, buyer] = await Promise.all([fundedClient(), fundedClient()]);
  mint = (await seller.launch({ name: "Lantern", symbol: "LNTRN", firstBuyLamports: SOL / 10n, toRing: true })).mint;
});

describe("OTC", () => {
  it("offers a block to one named buyer, visible to those two wallets only", async () => {
    const offer = await seller.offer({ buyer: buyer.address, mint, amount: 3_000_000n, priceLamports: 2n * SOL });
    expect((await buyer.offers()).map((listed) => listed.id)).toContain(offer.id);
    const stranger = new RingClient(call, newActor());
    expect(await stranger.offers()).toEqual([]);
    await expect(stranger.acceptOffer(offer.id)).rejects.toThrow(/not addressed to you/);
    await expect(stranger.cancelOffer(offer.id)).rejects.toThrow(/not your offer/);
    await seller.cancelOffer(offer.id);
  });

  it("refuses offers that cannot settle or make no sense", async () => {
    const base = { buyer: buyer.address, mint, amount: 1_000n, priceLamports: 1_000n };
    await expect(seller.offer({ ...base, amount: 10n ** 18n })).rejects.toThrow(/do not hold that block/);
    await expect(seller.offer({ ...base, buyer: seller.address })).rejects.toThrow(/another wallet/);
    await expect(seller.offer({ ...base, buyer: "bogus" })).rejects.toThrow(/buyer's address is not a valid Solana address/);
    await expect(seller.offer({ ...base, amount: 0n })).rejects.toThrow(/above zero/);
    await expect(seller.offer({ ...base, priceLamports: 0n })).rejects.toThrow(/above zero/);
    await expect(seller.offer({ ...base, mint: NATIVE })).rejects.toThrow(/choose a coin/);
    await expect(seller.offer({ ...base, hours: 0 })).rejects.toThrow(/1 to 168 hours/);
    await expect(seller.offer({ ...base, hours: 1.5 })).rejects.toThrow(/1 to 168 hours/);
    await expect(seller.acceptOffer("no-such-offer")).rejects.toThrow(/does not exist/);
  });

  it("moves nothing if the buyer cannot pay", async () => {
    const offer = await seller.offer({ buyer: buyer.address, mint, amount: 3_000_000n, priceLamports: 2n * SOL });
    const sellerBefore = await seller.ringBalance(mint);
    await expect(buyer.acceptOffer(offer.id)).rejects.toThrow(/does not cover the price/);
    expect(await seller.ringBalance(mint)).toBe(sellerBefore);
    expect(await buyer.ringBalance(mint)).toBe(0n);
    expect((await buyer.offers()).find((listed) => listed.id === offer.id)!.status).toBe("open"); // still acceptable once funded
    await seller.cancelOffer(offer.id);
  });

  it.each([1, 2])("settles both sides together and seals the coin, size and price (run %i)", async () => {
    await buyer.deposit(NATIVE, 3n * SOL);
    const offer = await seller.offer({ buyer: buyer.address, mint, amount: 3_000_000n, priceLamports: 2n * SOL });
    const before = {
      sellerCoin: await seller.ringBalance(mint),
      sellerSol: await seller.ringBalance(NATIVE),
      buyerCoin: await buyer.ringBalance(mint),
      buyerSol: await buyer.ringBalance(NATIVE),
    };
    const { event } = await buyer.acceptOffer(offer.id);
    expect(await seller.ringBalance(mint)).toBe(before.sellerCoin - 3_000_000n);
    expect(await buyer.ringBalance(mint)).toBe(before.buyerCoin + 3_000_000n);
    expect(await seller.ringBalance(NATIVE)).toBe(before.sellerSol + 2n * SOL);
    expect(await buyer.ringBalance(NATIVE)).toBe(before.buyerSol - 2n * SOL);
    await expectCovered(mint);
    await expectCovered(NATIVE);

    const outside = (await call("ring/public", { wallet: buyer.address })).events.find((seen) => seen.id === event.id)!;
    expect(outside.public).toEqual({ seller: seller.address, buyer: buyer.address });
    expect(JSON.stringify(outside)).not.toMatch(/3000000|2000000000/);
    await expect(buyer.acceptOffer(offer.id)).rejects.toThrow(/already settled/);
    await expect(seller.cancelOffer(offer.id)).rejects.toThrow(/already settled/);

    restartServer();
    expect(await buyer.ringBalance(mint)).toBe(before.buyerCoin + 3_000_000n);
  });

  it("an offer the seller can no longer cover fails cleanly, and an expired or cancelled one cannot be accepted", async () => {
    await buyer.deposit(NATIVE, SOL);
    const all = await seller.ringBalance(mint);
    const offer = await seller.offer({ buyer: buyer.address, mint, amount: all, priceLamports: 1_000n });
    const elsewhere = await fundedClient();
    await elsewhere.register();
    await seller.transfer(elsewhere.address, mint, 1n); // the block is no longer whole
    const buyerSol = await buyer.ringBalance(NATIVE);
    await expect(buyer.acceptOffer(offer.id)).rejects.toThrow(/seller no longer holds the block/);
    expect(await buyer.ringBalance(NATIVE)).toBe(buyerSol);

    const second = await seller.offer({ buyer: buyer.address, mint, amount: 10n, priceLamports: 10n });
    state().offers.find((listed) => listed.id === second.id)!.expiresAt = Date.now() - 1; // as if a day had passed
    await expect(buyer.acceptOffer(second.id)).rejects.toThrow(/expired/);

    const third = await seller.offer({ buyer: buyer.address, mint, amount: 10n, priceLamports: 10n });
    await seller.cancelOffer(third.id);
    await expect(buyer.acceptOffer(third.id)).rejects.toThrow(/already cancelled/);
  });
});
