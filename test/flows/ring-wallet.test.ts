/** Deposit, transfer, withdraw, pay links and the browser-made wallet, checked against the chain after every step. */
import { beforeAll, describe, expect, it } from "vitest";
import { decryptBackup, encryptBackup } from "../../lib/backup";
import { NATIVE } from "../../lib/constants";
import { newActor } from "../../lib/keys";
import { parsePayLink, payLink } from "../../lib/paylink";
import { RingClient } from "../../lib/sdk";
import { SOL, call, escrowOnChain, expectCovered, freshServer, fundedClient, logsOf, onChain, restartServer } from "./helpers";

freshServer();
let holder: RingClient, friend: RingClient, mint: string;
beforeAll(async () => {
  [holder, friend] = await Promise.all([fundedClient(), fundedClient()]);
  mint = (await holder.launch({ name: "Lantern", symbol: "LNTRN", firstBuyLamports: SOL / 10n })).mint; // the first buy stays in the wallet
  await friend.register();
});

describe("deposit", () => {
  it.each([1, 2])("moves coins from the wallet into escrow on-chain and credits the same amount (run %i)", async () => {
    const walletBefore = await onChain(holder.address, mint),
      ringBefore = await holder.ringBalance(mint);
    const amount = walletBefore / 4n;
    const sent = await holder.deposit(mint, amount);
    expect(sent.credited).toEqual([{ wallet: holder.address, coin: mint, amount: amount.toString() }]); // public, with the amount
    expect(await onChain(holder.address, mint)).toBe(walletBefore - amount);
    expect(await holder.ringBalance(mint)).toBe(ringBefore + amount);
    expect(await holder.publicBalance(mint)).toBe(await onChain(holder.address, mint));
    await expectCovered(mint);
    restartServer();
    expect(await holder.ringBalance(mint)).toBe(ringBefore + amount);
  });

  it("takes SOL too", async () => {
    await holder.deposit(NATIVE, 3n * SOL);
    expect(await holder.ringBalance(NATIVE)).toBe(3n * SOL);
    await expectCovered(NATIVE);
  });

  it("refuses zero, more than the wallet holds, and a malformed coin address", async () => {
    await expect(holder.deposit(mint, 0n)).rejects.toThrow(/above zero/);
    await expect(holder.deposit(mint, (await onChain(holder.address, mint)) + 1n)).rejects.toThrow(/not enough in the wallet/);
    await expect(holder.deposit("nonsense", 5n)).rejects.toThrow(/coin address is not a valid Solana address/);
    const ringBefore = await holder.ringBalance(mint);
    await expect(holder.deposit(mint, 2n ** 64n)).rejects.toThrow(/larger than the chain can hold/);
    expect(await holder.ringBalance(mint)).toBe(ringBefore);
  });

  it("a wallet that holds nothing gets a clear answer", async () => {
    const empty = new RingClient(call, newActor());
    await expect(empty.deposit(NATIVE, SOL)).rejects.toThrow(/not enough in the wallet/);
    expect(await empty.ringBalance(NATIVE)).toBe(0n);
  });
});

describe("transfer", () => {
  it.each([1, 2])("moves the coins, shows both wallets, and seals the coin, amount and memo (run %i)", async () => {
    const before = await holder.ringBalance(mint),
      friendBefore = await friend.ringBalance(mint),
      escrowBefore = await escrowOnChain(mint);
    const event = await holder.transfer(friend.address, mint, 5_000_000n, "for the poster");
    expect(await holder.ringBalance(mint)).toBe(before - 5_000_000n);
    expect(await friend.ringBalance(mint)).toBe(friendBefore + 5_000_000n);
    // Nothing moved on-chain: a transfer is between Ring balances.
    expect(await escrowOnChain(mint)).toBe(escrowBefore);
    await expectCovered(mint);

    const outside = (await call("ring/public", { wallet: friend.address })).events.find((seen) => seen.id === event.id)!;
    expect(outside.public).toEqual({ from: holder.address, to: friend.address });
    const serialised = JSON.stringify(outside);
    for (const secret of ["5000000", mint, "poster"]) expect(serialised).not.toContain(secret);

    const inside = (await friend.ringHistory()).find((seen) => seen.id === event.id)!;
    expect(inside.sealed).toEqual({ coin: mint, amount: "5000000", memo: "for the poster" });
    expect(await new RingClient(call, newActor()).ringHistory()).toEqual([]); // a third wallet sees nothing of it
  });

  it("refuses an unregistered recipient, a malformed address, yourself, zero and too much, and moves nothing", async () => {
    const before = await holder.ringBalance(mint);
    await expect(holder.transfer(newActor().address, mint, 1n)).rejects.toThrow(/not registered with the Ring/);
    await expect(holder.transfer("definitely not an address", mint, 1n)).rejects.toThrow(/recipient's address is not a valid Solana address/);
    await expect(holder.transfer(holder.address, mint, 1n)).rejects.toThrow(/your own wallet/);
    await expect(holder.transfer(friend.address, mint, 0n)).rejects.toThrow(/above zero/);
    await expect(holder.transfer(friend.address, mint, before + 1n)).rejects.toThrow(/Ring balance is too low/);
    await expect(holder.transfer(friend.address, mint, 1n, "bad\u0000memo")).rejects.toThrow(/cannot be shown/);
    expect(await holder.ringBalance(mint)).toBe(before);
  });
});

describe("withdraw", () => {
  it.each([1, 2])("pays coins out of escrow to the wallet on-chain, publicly (run %i)", async () => {
    const ringBefore = await holder.ringBalance(mint),
      walletBefore = await onChain(holder.address, mint);
    const result = await holder.withdraw(mint, 2_000_000n);
    expect(result.pending).toBe(false);
    expect(result.event.public).toEqual({ wallet: holder.address, destination: holder.address, coin: mint, amount: "2000000" });
    await logsOf(result.signature); // it is on the chain and did not fail
    expect(await onChain(holder.address, mint)).toBe(walletBefore + 2_000_000n);
    expect(await holder.ringBalance(mint)).toBe(ringBefore - 2_000_000n);
    await expectCovered(mint);
    restartServer();
    expect(await holder.ringBalance(mint)).toBe(ringBefore - 2_000_000n);
  });

  it("can pay out to another wallet, and SOL as well", async () => {
    const other = newActor().address;
    await holder.withdraw(NATIVE, SOL, other);
    expect(await onChain(other, NATIVE)).toBe(SOL);
    await expectCovered(NATIVE);
  });

  it("refuses too much or a malformed destination, and a failed attempt changes nothing", async () => {
    const before = await holder.ringBalance(mint),
      walletBefore = await onChain(holder.address, mint);
    await expect(holder.withdraw(mint, before + 1n)).rejects.toThrow(/Ring balance is too low/);
    await expect(holder.withdraw(mint, 1_000n, "not-an-address")).rejects.toThrow(/destination address is not a valid Solana address/);
    await expect(holder.withdraw(mint, 0n)).rejects.toThrow(/above zero/);
    expect(await holder.ringBalance(mint)).toBe(before);
    expect(await onChain(holder.address, mint)).toBe(walletBefore);
  });
});

describe("pay links", () => {
  it.each([1, 2])("a link made by one wallet is paid by another through a sealed Ring transfer (run %i)", async () => {
    const link = payLink("https://example.test", { to: friend.address, mint, amount: "2500000", memo: "two prints" });
    const request = parsePayLink(link);
    expect(request.to).toBe(friend.address); // the address keeps its case through the link
    const before = await friend.ringBalance(mint);
    const event = await holder.transfer(request.to, request.mint, BigInt(request.amount), request.memo);
    expect(await friend.ringBalance(mint)).toBe(before + 2_500_000n);
    expect(event.public).toEqual({ from: holder.address, to: friend.address });
  });
});

describe("no wallet needed", () => {
  it("a key made in the browser, restored from its encrypted backup, is funded at its address and uses the Ring", async () => {
    const made = newActor();
    const restored = decryptBackup(
      JSON.parse(JSON.stringify(encryptBackup(made, "correct horse battery", { N: 2 ** 14, r: 8, p: 1 }))),
      "correct horse battery",
    );
    expect(restored.address).toBe(made.address);
    const browserWallet = new RingClient(call, restored);
    // "From any wallet or exchange": a plain public transfer to the deposit address.
    await holder.withdraw(NATIVE, SOL, browserWallet.address);
    expect(await onChain(browserWallet.address, NATIVE)).toBe(SOL);
    await browserWallet.deposit(NATIVE, SOL / 2n);
    expect(await browserWallet.ringBalance(NATIVE)).toBe(SOL / 2n);
    await expectCovered(NATIVE);
  });
});

describe("the SDK example", () => {
  it("runs as written and does what its comments say", async () => {
    const { launchAndTransfer } = await import("../../examples/launch-and-transfer");
    const lines: string[] = [];
    const { mara, ilya, coin, amount, sent } = await launchAndTransfer(call, (line) => lines.push(line));
    expect(await ilya.ringBalance(coin.mint)).toBe(amount);
    expect(await mara.ringBalance(coin.mint)).toBe(coin.firstBuyTokens - amount);
    // The public record of the transfer names the two wallets and nothing about the coin or the amount.
    expect(sent.public).toEqual({ from: mara.address, to: ilya.address });
    expect(JSON.stringify(sent.public)).not.toContain(coin.mint);
    expect(lines).toHaveLength(5);
    await expectCovered(coin.mint);
  });
});
