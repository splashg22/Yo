/**
 * Every flow, end to end on a local validator: the real pump.fun program, the real
 * Privacy Rings registration, and the mock Ring ledger for balances.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { signRequest } from "../lib/auth";
import { decryptBackup, encryptBackup } from "../lib/backup";
import { fromBase64 } from "../lib/bytes";
import { newActor, signMessage, type Actor } from "../lib/keys";
import { parsePayLink, payLink } from "../lib/paylink";
import { NATIVE } from "../lib/server/env";
import { run } from "../lib/server/handlers";
import { forget } from "../lib/server/store";
import { signTransaction } from "../lib/sign";

process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "ringpad-test-"));
process.env.RING_NETWORK = "local";
forget();

const connection = new Connection(process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const RING_PROGRAM = "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW";
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const SOL = 1_000_000_000n;

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = (op: string, input: object = {}) => run(op, input as Record<string, unknown>) as Promise<Any>;
const asWallet = async (op: string, actor: Actor, payload: object = {}) => call(op, await signRequest(op, actor.address, payload, (m) => signMessage(actor, m)));
async function send(base64: string, ...signers: Actor[]): Promise<string> {
  const signature = await connection.sendRawTransaction(fromBase64(signTransaction(base64, signers.map((s) => s.seed))));
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}
async function funded(): Promise<Actor> {
  const actor = newActor();
  await call("faucet", { wallet: actor.address });
  return actor;
}
const ringBalance = async (actor: Actor, mint: string) => BigInt((await asWallet("ring/mine", actor)).balances[mint] ?? "0");
const publicBalance = async (actor: Actor, mint: string) => BigInt((await call("wallet/public", { wallet: actor.address })).balances[mint] ?? "0");
async function launch(creator: Actor, options: { firstBuyLamports?: bigint; toRing?: boolean; name?: string; symbol?: string } = {}) {
  const mint = newActor();
  const name = options.name ?? "Test Coin", symbol = options.symbol ?? "TEST";
  const built = await call("launch/build", { wallet: creator.address, mint: mint.address, name, symbol, firstBuyLamports: options.firstBuyLamports?.toString(), toRing: options.toRing });
  const signature = await send(built.transaction, creator, mint);
  await call("launch/record", { mint: mint.address, signature, name, symbol });
  return { mint: mint.address, signature, firstBuyTokens: BigInt(built.firstBuyTokens) };
}
async function deposit(actor: Actor, mint: string, amount: bigint) {
  const built = await call("ring/deposit/build", { wallet: actor.address, mint, amount: amount.toString() });
  const signature = await send(built.transaction, actor);
  return { signature, ...(await call("ring/credit", { signature })) };
}
async function trade(actor: Actor, mint: string, side: "buy" | "sell", amount: bigint) {
  const built = await call("trade/build", { wallet: actor.address, mint, side, amount: amount.toString() });
  return { signature: await send(built.transaction, actor), expected: BigInt(built.expected) };
}

let creator: Actor, holder: Actor, coin: { mint: string; signature: string; firstBuyTokens: bigint };

beforeAll(async () => {
  [creator, holder] = await Promise.all([funded(), funded()]);
  // The copied devnet curve is small: about 0.85 SOL of buying completes it. Amounts here stay well under that.
  coin = await launch(creator, { firstBuyLamports: SOL / 20n, toRing: true, name: "Lantern", symbol: "LNTRN" });
});

describe("launch", () => {
  it("creates the coin on the pump.fun curve and registers it with the Ring in one transaction", async () => {
    const tx = await connection.getTransaction(coin.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    expect(tx?.meta?.err).toBeNull();
    const programs = tx!.transaction.message.getAccountKeys({ accountKeysFromLookups: tx!.meta!.loadedAddresses }).keySegments().flat().map((k) => k.toBase58());
    expect(programs).toContain(PUMP_PROGRAM);
    expect(programs).toContain(RING_PROGRAM);
    expect(tx!.meta!.logMessages!.some((l) => l.includes(`Program ${RING_PROGRAM} success`))).toBe(true);
    expect(tx!.transaction.signatures).toHaveLength(2); // the creator and the new coin's own key
  });

  it("puts the first buy straight into the creator's Ring balance, publicly", async () => {
    expect(coin.firstBuyTokens).toBeGreaterThan(0n);
    expect(await ringBalance(creator, coin.mint)).toBe(coin.firstBuyTokens);
    expect(await publicBalance(creator, coin.mint)).toBe(0n);
    const seen = (await call("ring/public", { wallet: creator.address })).events;
    expect(seen.find((e: Any) => e.kind === "deposit").public).toEqual({ wallet: creator.address, coin: coin.mint, amount: coin.firstBuyTokens.toString() });
  });

  it("works without a first buy", async () => {
    const plain = await launch(creator, { name: "Plain", symbol: "PLAIN" });
    expect(plain.firstBuyTokens).toBe(0n);
    expect(await ringBalance(creator, plain.mint)).toBe(0n);
    expect((await call("coin", { mint: plain.mint })).privacy.shareInRingPercent).toBe(0);
  });

  it("refuses a bad name or ticker, and will not list a coin that does not exist", async () => {
    const mint = newActor().address;
    await expect(call("launch/build", { wallet: creator.address, mint, name: "", symbol: "OK" })).rejects.toThrow(/name/);
    await expect(call("launch/build", { wallet: creator.address, mint, name: "Fine", symbol: "NO SPACES" })).rejects.toThrow(/ticker/);
    await expect(call("launch/record", { mint, signature: coin.signature, name: "Ghost", symbol: "GHOST" })).rejects.toThrow(/no bonding curve/);
  });
});

describe("explore", () => {
  it("lists the coin with a market cap read from the curve", async () => {
    const { coins } = await call("explore");
    const listed = coins.find((c: Any) => c.mint === coin.mint);
    expect(listed).toMatchObject({ name: "Lantern", symbol: "LNTRN", creator: creator.address });
    expect(BigInt(listed.marketCapLamports)).toBeGreaterThan(SOL / 4n);
    expect(listed.complete).toBe(false);
    expect((await call("stats")).launched).toBeGreaterThanOrEqual(2);
  });

  it("moves the price when someone buys on the curve, and that buy is public", async () => {
    const before = (await call("coin", { mint: coin.mint })).priceLamports;
    const bought = await trade(holder, coin.mint, "buy", SOL / 10n);
    expect(await publicBalance(holder, coin.mint)).toBe(bought.expected);
    const after = await call("coin", { mint: coin.mint });
    expect(after.priceLamports).toBeGreaterThan(before);
    expect(after.changePercent).toBeGreaterThan(0);
  });

  it("sells back to the curve", async () => {
    const held = await publicBalance(holder, coin.mint);
    const solBefore = await publicBalance(holder, NATIVE);
    await trade(holder, coin.mint, "sell", held / 4n);
    expect(await publicBalance(holder, coin.mint)).toBe(held - held / 4n);
    expect(await publicBalance(holder, NATIVE)).toBeGreaterThan(solBefore);
  });
});

describe("deposit", () => {
  it("moves coins from the wallet into the Ring and shows the amount publicly", async () => {
    const held = await publicBalance(holder, coin.mint);
    const amount = held / 2n;
    const result = await deposit(holder, coin.mint, amount);
    expect(result.credited).toEqual([{ wallet: holder.address, coin: coin.mint, amount: amount.toString() }]);
    expect(await ringBalance(holder, coin.mint)).toBe(amount);
    expect(await publicBalance(holder, coin.mint)).toBe(held - amount);
  });

  it("takes SOL too", async () => {
    await deposit(holder, NATIVE, 3n * SOL);
    expect(await ringBalance(holder, NATIVE)).toBe(3n * SOL);
  });

  it("credits a transaction once, and only to the wallet that paid for it", async () => {
    const before = await ringBalance(holder, NATIVE);
    const { signature } = await deposit(holder, NATIVE, SOL / 10n);
    expect((await call("ring/credit", { signature })).credited).toEqual([]);
    expect(await ringBalance(holder, NATIVE)).toBe(before + SOL / 10n);
    const stranger = newActor();
    expect(await ringBalance(stranger, NATIVE)).toBe(0n);
    await expect(call("ring/credit", { signature: "1".repeat(88) })).rejects.toThrow();
  });
});

describe("transfer", () => {
  it("needs the recipient to be registered with the Ring", async () => {
    const friend = newActor();
    await expect(asWallet("ring/transfer", holder, { to: friend.address, mint: coin.mint, amount: "1000" })).rejects.toThrow(/not registered/);
  });

  it("moves the coins, shows both wallets, and seals the coin and the amount", async () => {
    const friend = newActor();
    await asWallet("ring/register", friend);
    const before = await ringBalance(holder, coin.mint);
    const { event } = await asWallet("ring/transfer", holder, { to: friend.address, mint: coin.mint, amount: "5000000", memo: "for the poster" });
    expect(await ringBalance(holder, coin.mint)).toBe(before - 5_000_000n);
    expect(await ringBalance(friend, coin.mint)).toBe(5_000_000n);

    const outside = (await call("ring/public", { wallet: friend.address })).events.find((e: Any) => e.id === event.id);
    expect(outside.public).toEqual({ from: holder.address, to: friend.address });
    expect(JSON.stringify(outside)).not.toContain("5000000");
    expect(JSON.stringify(outside)).not.toContain(coin.mint);
    expect(JSON.stringify(outside)).not.toContain("poster");

    const inside = (await asWallet("ring/mine", friend)).history.find((e: Any) => e.id === event.id);
    expect(inside.sealed).toEqual({ coin: coin.mint, amount: "5000000", memo: "for the poster" });
    const third = newActor();
    expect((await asWallet("ring/mine", third)).history).toEqual([]);
  });

  it("cannot send more than the balance, or to yourself", async () => {
    const friend = newActor();
    await asWallet("ring/register", friend);
    const all = await ringBalance(holder, coin.mint);
    await expect(asWallet("ring/transfer", holder, { to: friend.address, mint: coin.mint, amount: (all + 1n).toString() })).rejects.toThrow(/too low/);
    await expect(asWallet("ring/transfer", holder, { to: holder.address, mint: coin.mint, amount: "1" })).rejects.toThrow(/different recipient/);
    expect(await ringBalance(holder, coin.mint)).toBe(all);
  });
});

describe("withdraw", () => {
  it("pays coins out to the wallet, publicly", async () => {
    const ringBefore = await ringBalance(holder, coin.mint), walletBefore = await publicBalance(holder, coin.mint);
    const { event, signature } = await asWallet("ring/withdraw", holder, { mint: coin.mint, amount: "2000000" });
    expect(await ringBalance(holder, coin.mint)).toBe(ringBefore - 2_000_000n);
    expect(await publicBalance(holder, coin.mint)).toBe(walletBefore + 2_000_000n);
    expect(event.public).toEqual({ wallet: holder.address, destination: holder.address, coin: coin.mint, amount: "2000000" });
    expect((await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }))?.meta?.err).toBeNull();
  });

  it("can pay out to another wallet, and SOL as well", async () => {
    const other = newActor();
    await asWallet("ring/withdraw", holder, { mint: NATIVE, amount: SOL.toString(), destination: other.address });
    expect(await publicBalance(other, NATIVE)).toBe(SOL);
  });

  it("cannot take out more than the balance, and a failed attempt changes nothing", async () => {
    const before = await ringBalance(holder, coin.mint);
    await expect(asWallet("ring/withdraw", holder, { mint: coin.mint, amount: (before + 1n).toString() })).rejects.toThrow(/too low/);
    await expect(asWallet("ring/withdraw", holder, { mint: coin.mint, amount: "1000", destination: "not-an-address" })).rejects.toThrow();
    expect(await ringBalance(holder, coin.mint)).toBe(before);
  });
});

describe("privacy score", () => {
  it("is the share of supply in Ring balances and the number of wallets that deposited", async () => {
    const { privacy } = await call("coin", { mint: coin.mint });
    const escrowHolds = (await ringBalance(creator, coin.mint)) + (await ringBalance(holder, coin.mint)) + 5_000_000n; // the friend's transfer stays in the Ring
    expect(BigInt(privacy.inRing)).toBe(escrowHolds);
    expect(privacy.shareInRingPercent).toBeCloseTo(Number((escrowHolds * 1_000_000n) / BigInt(privacy.supply)) / 10_000, 4);
    expect(privacy.walletsThatDeposited).toBe(2); // the creator's first buy, and the holder. A transfer does not count: it is sealed.
  });
});

describe("OTC", () => {
  let buyer: Actor, offerId: string;
  it("lets the seller offer a block to one named buyer", async () => {
    buyer = await funded();
    await expect(asWallet("otc/offer", holder, { buyer: buyer.address, mint: coin.mint, amount: (10n ** 30n).toString(), priceLamports: SOL.toString() })).rejects.toThrow(/do not hold/);
    const { offer } = await asWallet("otc/offer", holder, { buyer: buyer.address, mint: coin.mint, amount: "3000000", priceLamports: (2n * SOL).toString() });
    offerId = offer.id;
    expect((await asWallet("otc/mine", buyer)).offers.map((o: Any) => o.id)).toContain(offerId);
    const stranger = newActor();
    expect((await asWallet("otc/mine", stranger)).offers).toEqual([]);
    await expect(asWallet("otc/accept", stranger, { id: offerId })).rejects.toThrow(/not addressed to you/);
  });

  it("moves nothing if the buyer cannot pay", async () => {
    const sellerBefore = await ringBalance(holder, coin.mint);
    await expect(asWallet("otc/accept", buyer, { id: offerId })).rejects.toThrow(/does not cover the price/);
    expect(await ringBalance(holder, coin.mint)).toBe(sellerBefore);
    expect(await ringBalance(buyer, coin.mint)).toBe(0n);
  });

  it("settles both sides together and seals the coin, size and price", async () => {
    await deposit(buyer, NATIVE, 5n * SOL);
    const sellerCoin = await ringBalance(holder, coin.mint), sellerSol = await ringBalance(holder, NATIVE);
    const { event } = await asWallet("otc/accept", buyer, { id: offerId });
    expect(await ringBalance(buyer, coin.mint)).toBe(3_000_000n);
    expect(await ringBalance(buyer, NATIVE)).toBe(3n * SOL);
    expect(await ringBalance(holder, coin.mint)).toBe(sellerCoin - 3_000_000n);
    expect(await ringBalance(holder, NATIVE)).toBe(sellerSol + 2n * SOL);
    const outside = (await call("ring/public", { wallet: buyer.address })).events.find((e: Any) => e.id === event.id);
    expect(outside.public).toEqual({ seller: holder.address, buyer: buyer.address });
    expect(JSON.stringify(outside)).not.toMatch(/3000000|2000000000/);
    await expect(asWallet("otc/accept", buyer, { id: offerId })).rejects.toThrow(/already settled/);
  });

  it("can be cancelled by the seller only", async () => {
    const { offer } = await asWallet("otc/offer", holder, { buyer: buyer.address, mint: coin.mint, amount: "1000", priceLamports: "1000" });
    await expect(asWallet("otc/cancel", buyer, { id: offer.id })).rejects.toThrow(/not your offer/);
    await asWallet("otc/cancel", holder, { id: offer.id });
    await expect(asWallet("otc/accept", buyer, { id: offer.id })).rejects.toThrow(/already cancelled/);
  });
});

describe("pay links", () => {
  it("carries the recipient, coin, amount and memo, and nothing else", () => {
    const link = payLink("https://example.test", { to: holder.address, mint: coin.mint, amount: "2500000", memo: "poster print" });
    expect(parsePayLink(link)).toEqual({ to: holder.address, mint: coin.mint, amount: "2500000", memo: "poster print" });
    expect(new URL(link).pathname).toBe("/pay");
    expect([...new URL(link).searchParams.keys()].sort()).toEqual(["amount", "coin", "memo", "to"]);
  });
  it("rejects a link that was tampered with", () => {
    const good = payLink("https://example.test", { to: holder.address, mint: coin.mint, amount: "1" });
    for (const bad of [good.replace(holder.address, "nobody"), good.replace("amount=1", "amount=-5"), good.replace("amount=1", "amount=1.5"), good.replace(`coin=${coin.mint}`, "coin=x"), "not a link at all"]) {
      expect(() => parsePayLink(bad), bad).toThrow();
    }
  });
  it("pays through a Ring transfer with the amount sealed", async () => {
    const payer = await funded();
    await trade(payer, coin.mint, "buy", SOL / 50n);
    await deposit(payer, coin.mint, 4_000_000n);
    const request = parsePayLink(payLink("https://example.test", { to: holder.address, mint: coin.mint, amount: "2500000", memo: "poster print" }));
    const before = await ringBalance(holder, coin.mint);
    const { event } = await asWallet("ring/transfer", payer, request);
    expect(await ringBalance(holder, coin.mint)).toBe(before + 2_500_000n);
    expect(event.public).toEqual({ from: payer.address, to: holder.address });
  });
});

describe("no wallet needed", () => {
  it("makes a key in the browser whose encrypted backup restores the same address", () => {
    const wallet = newActor();
    const backup = encryptBackup(wallet, "correct horse battery", { N: 2 ** 14, r: 8, p: 1 });
    const text = JSON.stringify(backup);
    expect(text).toContain(wallet.address);
    expect(text).not.toContain(Buffer.from(wallet.seed).toString("base64"));
    const restored = decryptBackup(JSON.parse(text), "correct horse battery");
    expect(restored.address).toBe(wallet.address);
    expect(Buffer.from(restored.seed)).toEqual(Buffer.from(wallet.seed));
  });
  it("refuses a wrong password, a short password and an altered file", () => {
    const wallet = newActor();
    expect(() => encryptBackup(wallet, "short")).toThrow(/8 characters/);
    const backup = encryptBackup(wallet, "correct horse battery", { N: 2 ** 14, r: 8, p: 1 });
    expect(() => decryptBackup(backup, "wrong horse battery")).toThrow(/wrong password/);
    expect(() => decryptBackup({ ...backup, address: newActor().address }, "correct horse battery")).toThrow(/wrong password/);
    expect(() => decryptBackup({ ...backup, kdf: { ...backup.kdf, N: 2 } }, "correct horse battery")).toThrow(/unexpected settings/);
    expect(() => decryptBackup({ hello: "world" }, "correct horse battery")).toThrow(/not a wallet backup/);
  });
  it("is funded at its address from another wallet and then uses the Ring like any wallet", async () => {
    const browserWallet = decryptBackup(encryptBackup(newActor(), "correct horse battery", { N: 2 ** 14, r: 8, p: 1 }), "correct horse battery");
    // "From any wallet or exchange": a plain public transfer to the deposit address.
    await asWallet("ring/withdraw", holder, { mint: NATIVE, amount: SOL.toString(), destination: browserWallet.address });
    expect(await publicBalance(browserWallet, NATIVE)).toBe(SOL);
    await deposit(browserWallet, NATIVE, SOL / 2n);
    expect(await ringBalance(browserWallet, NATIVE)).toBe(SOL / 2n);
  });
});

describe("creator fees", () => {
  it("claims the fees publicly and lands them in the creator's Ring balance in the same transaction", async () => {
    const claimable = BigInt((await call("fees/claimable", { wallet: creator.address })).lamports);
    expect(claimable).toBeGreaterThan(0n); // the trades above paid the creator a fee
    const before = await ringBalance(creator, NATIVE);
    const built = await call("fees/build", { wallet: creator.address, toRing: true });
    const signature = await send(built.transaction, creator);
    const { credited } = await call("ring/credit", { signature });
    expect(credited).toEqual([{ wallet: creator.address, coin: NATIVE, amount: claimable.toString() }]); // public, with the amount
    expect(await ringBalance(creator, NATIVE)).toBe(before + claimable);
    await expect(call("fees/build", { wallet: creator.address })).rejects.toThrow(/no creator fees/);
  });
});

describe("signed requests", () => {
  it("rejects a forged, replayed, stale or mislabelled request", async () => {
    const thief = newActor();
    const forged = await signRequest("ring/withdraw", holder.address, { mint: NATIVE, amount: "1" }, (m) => signMessage(thief, m));
    await expect(call("ring/withdraw", forged)).rejects.toThrow(/does not match the wallet/);
    const once = await signRequest("ring/mine", holder.address, {}, (m) => signMessage(holder, m));
    await call("ring/mine", once);
    await expect(call("ring/mine", once)).rejects.toThrow(/already used/);
    const stale = await signRequest("ring/mine", holder.address, {}, (m) => signMessage(holder, m), Date.now() - 600_000);
    await expect(call("ring/mine", stale)).rejects.toThrow(/too old/);
    const other = await signRequest("ring/mine", holder.address, { mint: NATIVE, amount: "1" }, (m) => signMessage(holder, m));
    await expect(call("ring/withdraw", other)).rejects.toThrow(/different action/);
    await expect(call("ring/mine", { body: { wallet: holder.address } })).rejects.toThrow(/must be signed/);
    const edited = await signRequest("ring/transfer", holder.address, { to: thief.address, mint: NATIVE, amount: "1" }, (m) => signMessage(holder, m));
    (edited.body as Any).amount = "999999999";
    await expect(call("ring/transfer", edited)).rejects.toThrow(/does not match the wallet/);
  });
});

describe("the mock stays local", () => {
  it("refuses to run against anything but a local validator", async () => {
    const url = process.env.LOCAL_RPC_URL;
    process.env.LOCAL_RPC_URL = "https://api.devnet.solana.com";
    try {
      const wallet = newActor();
      await expect(asWallet("ring/register", wallet)).rejects.toThrow(/local-validator mock/);
      await expect(call("faucet", { wallet: wallet.address })).rejects.toThrow(/local-validator mock/);
    } finally {
      if (url === undefined) delete process.env.LOCAL_RPC_URL; else process.env.LOCAL_RPC_URL = url;
    }
    process.env.RING_NETWORK = "devnet";
    try { await expect(asWallet("ring/register", newActor())).rejects.toThrow(/local-validator mock/); }
    finally { process.env.RING_NETWORK = "local"; }
  });
});
