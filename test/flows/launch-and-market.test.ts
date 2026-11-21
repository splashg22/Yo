/** Launching, the curve, Explore, the privacy score and creator fees, on the real pump.fun program. */
import { beforeAll, describe, expect, it } from "vitest";
import { NATIVE } from "../../lib/constants";
import { newActor } from "../../lib/keys";
import { RingClient } from "../../lib/sdk";
import { state } from "../../lib/server/store";
import {
  PUMP_PROGRAM,
  RING_PROGRAM,
  SOL,
  call,
  chain,
  expectCovered,
  freshServer,
  fundedClient,
  logsOf,
  onChain,
  restartServer,
  unknownSignature,
} from "./helpers";

freshServer();
let creator: RingClient, trader: RingClient;
beforeAll(async () => {
  [creator, trader] = await Promise.all([fundedClient(), fundedClient()]);
});

describe("launch", () => {
  // Twice in a row: the second run proves nothing was left behind by the first.
  it.each([1, 2])("creates the coin on the curve and registers it with the Ring in one transaction (run %i)", async (runNumber) => {
    const launched = await creator.launch({ name: `Lantern ${runNumber}`, symbol: `LNT${runNumber}`, firstBuyLamports: SOL / 20n, toRing: true });
    const logs = await logsOf(launched.signature);
    expect(logs.some((line) => line === `Program ${PUMP_PROGRAM} success`)).toBe(true);
    expect(logs.some((line) => line === `Program ${RING_PROGRAM} success`)).toBe(true);
    const transaction = await chain.getTransaction(launched.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    expect(transaction!.transaction.signatures).toHaveLength(2); // the creator, and the new coin's own key

    // The first buy went into the Ring: the chain shows the coins in escrow, none in the creator's wallet.
    expect(launched.firstBuyTokens).toBeGreaterThan(0n);
    expect(await onChain(creator.address, launched.mint)).toBe(0n);
    expect(await creator.ringBalance(launched.mint)).toBe(launched.firstBuyTokens);
    await expectCovered(launched.mint);

    // Listed under the name it was built with, with the creator the chain reports.
    const listed = await call("coin", { mint: launched.mint });
    expect(listed).toMatchObject({ name: `Lantern ${runNumber}`, symbol: `LNT${runNumber}`, creator: creator.address, signature: launched.signature });

    restartServer();
    expect(await creator.ringBalance(launched.mint)).toBe(launched.firstBuyTokens);
    expect((await call("coin", { mint: launched.mint })).name).toBe(`Lantern ${runNumber}`);
  });

  it("works without a first buy, and with the first buy kept in the wallet", async () => {
    const plain = await creator.launch({ name: "Plain", symbol: "PLAIN" });
    expect(plain.firstBuyTokens).toBe(0n);
    expect((await call("coin", { mint: plain.mint })).privacy).toMatchObject({ inRing: "0", shareInRingPartsPerMillion: 0, walletsThatDeposited: 0 });
    const kept = await creator.launch({ name: "Kept", symbol: "KEPT", firstBuyLamports: SOL / 50n, toRing: false });
    expect(await onChain(creator.address, kept.mint)).toBe(kept.firstBuyTokens);
    expect(await creator.ringBalance(kept.mint)).toBe(0n);
  });

  it("refuses a bad name, ticker, address or first buy before anything is built", async () => {
    const mint = newActor().address;
    const base = { wallet: creator.address, mint, name: "Fine", symbol: "FINE" };
    await expect(call("launch/build", { ...base, name: "" })).rejects.toThrow(/coin name.*missing/);
    await expect(call("launch/build", { ...base, name: "x".repeat(33) })).rejects.toThrow(/too long/);
    await expect(call("launch/build", { ...base, name: "bad‮name" })).rejects.toThrow(/cannot be shown/);
    await expect(call("launch/build", { ...base, symbol: "NO SPACES" })).rejects.toThrow(/ticker/);
    await expect(call("launch/build", { ...base, wallet: "not-an-address" })).rejects.toThrow(/wallet address is not a valid Solana address/);
    await expect(call("launch/build", { ...base, mint: "0OIl" })).rejects.toThrow(/not a valid Solana address/);
    await expect(call("launch/build", { ...base, firstBuyLamports: "1" })).rejects.toThrow(/too small to buy anything/);
    await expect(call("launch/build", { ...base, firstBuyLamports: "1.5" })).rejects.toThrow(/whole number of base units/);
    await expect(call("launch/build", { ...base, firstBuyLamports: "99999999999999999999999" })).rejects.toThrow(/larger than the chain can hold/);
  });

  it("lists only coins this site built, under the name they were built with", async () => {
    // A coin created on the curve by someone else's transaction is not listed, whatever a caller claims.
    const outsider = await fundedClient();
    const before = state().coins.length;
    const built = await call("launch/build", { wallet: outsider.address, mint: newActor().address, name: "Real", symbol: "REAL" });
    expect(built.transaction).toBeTruthy();
    expect(state().coins.length).toBe(before); // building is not launching
    await expect(call("coin", { mint: newActor().address })).rejects.toThrow(/not launched here/);
    await expect(call("ring/credit", { signature: unknownSignature() })).rejects.toThrow(/not confirmed/);
    await expect(call("ring/credit", { signature: "1".repeat(88) })).rejects.toThrow(/not a transaction signature/);
  });
});

describe("the curve and Explore", () => {
  let mint: string;
  beforeAll(async () => {
    mint = (await creator.launch({ name: "Harbour", symbol: "HRBR", firstBuyLamports: SOL / 20n, toRing: true })).mint;
  });

  it("shows whole-number prices read from the curve", async () => {
    const coin = (await call("explore")).coins.find((listed) => listed.mint === mint)!;
    expect(BigInt(coin.marketCapLamports)).toBeGreaterThan(SOL / 4n);
    expect(BigInt(coin.microLamportsPerCoin)).toBeGreaterThan(0n);
    expect(Number.isInteger(coin.changeBasisPoints)).toBe(true);
    expect(Number.isInteger(coin.privacy.shareInRingPartsPerMillion)).toBe(true);
    expect(coin.complete).toBe(false);
  });

  it.each([1, 2])("a buy is public, lands in the wallet, and moves the price (run %i)", async () => {
    const before = await call("coin", { mint });
    const walletBefore = await onChain(trader.address, mint);
    const bought = await trader.trade(mint, "buy", SOL / 20n);
    expect(await onChain(trader.address, mint)).toBe(walletBefore + bought.expected);
    expect(await trader.publicBalance(mint)).toBe(await onChain(trader.address, mint)); // the app shows what the chain holds
    const after = await call("coin", { mint });
    expect(BigInt(after.microLamportsPerCoin)).toBeGreaterThan(BigInt(before.microLamportsPerCoin));
    expect(after.changeBasisPoints).toBeGreaterThan(0);
  });

  it("a sell pays SOL back", async () => {
    const held = await onChain(trader.address, mint);
    const solBefore = await onChain(trader.address, NATIVE);
    await trader.trade(mint, "sell", held / 4n);
    expect(await onChain(trader.address, mint)).toBe(held - held / 4n);
    expect(await onChain(trader.address, NATIVE)).toBeGreaterThan(solBefore);
  });

  it("refuses trades that cannot work, with a reason", async () => {
    await expect(trader.trade(mint, "buy", 1n)).rejects.toThrow(/too little SOL to buy anything/);
    await expect(call("trade/build", { wallet: trader.address, mint, side: "buy", amount: "0" })).rejects.toThrow(/above zero/);
    await expect(call("trade/build", { wallet: trader.address, mint: newActor().address, side: "buy", amount: "1000" })).rejects.toThrow(/does not exist/);
    const broke = await fundedClient();
    await expect(broke.trade(mint, "sell", 1_000_000n)).rejects.toThrow(/you hold none of this coin in your wallet/);
    await expect(trader.trade(mint, "sell", 10n ** 18n)).rejects.toThrow(/you hold less than that in your wallet/);
    const empty = new RingClient(call, newActor()); // a wallet that has never held anything
    await expect(empty.trade(mint, "buy", SOL / 100n)).rejects.toThrow(/not enough in the wallet/);
  });

  it("the privacy score is the share of supply in Ring balances and the wallets that deposited", async () => {
    const deposited = (await onChain(trader.address, mint)) / 2n;
    await trader.deposit(mint, deposited);
    const friend = await fundedClient();
    await friend.register();
    await trader.transfer(friend.address, mint, 1_000n); // sealed: it must not count as a depositor
    const { privacy } = await call("coin", { mint });
    const inRing = (await creator.ringBalance(mint)) + deposited;
    expect(BigInt(privacy.inRing)).toBe(inRing);
    expect(privacy.shareInRingPartsPerMillion).toBe(Number((inRing * 1_000_000n) / BigInt(privacy.supply)));
    expect(privacy.walletsThatDeposited).toBe(2);
    await expectCovered(mint);
  });

  it("creator fees are claimed publicly and land in the Ring balance in the same transaction", async () => {
    const claimable = BigInt((await call("fees/claimable", { wallet: creator.address })).lamports);
    expect(claimable).toBeGreaterThan(0n);
    const ringBefore = await creator.ringBalance(NATIVE);
    const claimed = await creator.claimFees(true);
    expect(claimed.claimed).toBe(claimable);
    expect(await creator.ringBalance(NATIVE)).toBe(ringBefore + claimable);
    const receipt = await call("tx/status", { signature: claimed.signature });
    expect(receipt).toMatchObject({
      status: "confirmed",
      payer: creator.address,
      deposits: [{ wallet: creator.address, coin: NATIVE, amount: claimable.toString() }],
    });
    await expect(creator.claimFees(true)).rejects.toThrow(/no creator fees/);
    await expectCovered(NATIVE);
  });

  it("gives a receipt for any transaction, and says so when there is none", async () => {
    const receipt = await call("tx/status", { signature: (await trader.trade(mint, "buy", SOL / 100n)).signature });
    expect(receipt.status).toBe("confirmed");
    expect(receipt.programs).toContain(PUMP_PROGRAM);
    expect(BigInt(receipt.feeLamports!)).toBeGreaterThan(0n);
    expect((await call("tx/status", { signature: unknownSignature() })).status).toBe("not-found");
    await expect(call("tx/status", { signature: "garbage" })).rejects.toThrow(/not a transaction signature/);
  });
});

describe("public history, read from the chain", () => {
  it("lists a coin's curve activity and a wallet's transactions newest first, and a receipt states what the wallet spent and received", async () => {
    const creator = await fundedClient();
    const buyer = await fundedClient();
    const launched = await creator.launch({ name: "Ledger", symbol: "LDGR" });
    const [solBefore, coinBefore] = [await onChain(buyer.address, NATIVE), await onChain(buyer.address, launched.mint)];
    const bought = await buyer.trade(launched.mint, "buy", SOL / 20n);
    const [solAfter, coinAfter] = [await onChain(buyer.address, NATIVE), await onChain(buyer.address, launched.mint)];

    const onCurve = (await call("coin/activity", { mint: launched.mint })).activity;
    expect(onCurve.map((entry) => entry.signature)).toEqual([bought.signature, launched.signature]);
    expect(onCurve.every((entry) => !entry.failed && typeof entry.blockTime === "number")).toBe(true);
    const mine = (await call("wallet/activity", { wallet: buyer.address })).activity;
    expect(mine[0]!.signature).toBe(bought.signature);
    expect(mine).toHaveLength(2); // the faucet's airdrop, then the buy

    // The receipt's figures are the chain's own before-and-after balances, to the base unit.
    const receipt = await call("tx/status", { signature: bought.signature });
    expect(receipt.payer).toBe(buyer.address);
    expect(Object.fromEntries(receipt.changes.map((change) => [change.mint, BigInt(change.amount)]))).toEqual({
      [NATIVE]: solAfter - solBefore,
      [launched.mint]: coinAfter - coinBefore,
    });
    expect(solAfter - solBefore).toBeLessThan(-(SOL / 20n));
    expect(coinAfter - coinBefore).toBeGreaterThan(0n);
  });

  it("refuses a malformed address, a coin that was not launched here, and reports an unknown signature as not found", async () => {
    await expect(call("coin/activity", { mint: "nonsense" })).rejects.toThrow(/valid Solana address/);
    await expect(call("coin/activity", { mint: newActor().address })).rejects.toThrow(/not launched here/);
    await expect(call("wallet/activity", { wallet: "" })).rejects.toThrow(/wallet address/);
    expect((await call("wallet/activity", { wallet: newActor().address })).activity).toEqual([]);
    const missing = await call("tx/status", { signature: unknownSignature() });
    expect(missing).toMatchObject({ status: "not-found", changes: [], deposits: [] });
  });
});

describe("the price record", () => {
  it("keeps a reading each time the price is seen to change, oldest first, and refuses coins it does not know", async () => {
    const creator = await fundedClient();
    const launched = await creator.launch({ name: "Record", symbol: "RCRD" });
    const first = BigInt((await call("coin", { mint: launched.mint })).microLamportsPerCoin);
    await creator.trade(launched.mint, "buy", SOL / 20n);
    const second = BigInt((await call("coin", { mint: launched.mint })).microLamportsPerCoin);
    expect(second).toBeGreaterThan(first);
    const { points } = await call("coin/prices", { mint: launched.mint });
    expect(points.map((point) => BigInt(point.microLamportsPerCoin))).toEqual([first, second]);
    expect(points[0]!.at).toBeLessThanOrEqual(points[1]!.at);
    // Reading again without a trade adds nothing: the record is of changes, not of visits.
    await call("coin", { mint: launched.mint });
    expect((await call("coin/prices", { mint: launched.mint })).points).toHaveLength(2);
    await expect(call("coin/prices", { mint: newActor().address })).rejects.toThrow(/not launched here/);
    await expect(call("coin/prices", { mint: "x" })).rejects.toThrow(/valid Solana address/);
  });
});
