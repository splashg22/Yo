/**
 * What happens when things go wrong: concurrent requests, a browser that disappears
 * mid-action, a dead or slow chain connection, forged requests. Nothing may be lost,
 * duplicated or left stuck, and every failure must say why.
 */
import { createServer, type AddressInfo } from "node:net";
import { VersionedTransaction } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import { signRequest } from "../../lib/auth";
import { fromBase64 } from "../../lib/bytes";
import { NATIVE } from "../../lib/constants";
import { newActor, signMessage } from "../../lib/keys";
import { RingClient } from "../../lib/sdk";
import { PAYOUT_FEE_LAMPORTS, escrow, payoutCost, preparePayout, sendPayout } from "../../lib/server/escrow";
import { preparing } from "../../lib/server/settle";
import { ring } from "../../lib/server/ring";
import { state } from "../../lib/server/store";
import { signTransaction } from "../../lib/sign";
import { RPC_URL, SOL, call, chain, expectCovered, freshServer, fundedClient, onChain, restartServer, unknownSignature } from "./helpers";

freshServer();
let holder: RingClient, mint: string;
beforeAll(async () => {
  holder = await fundedClient();
  mint = (await holder.launch({ name: "Lantern", symbol: "LNTRN", firstBuyLamports: SOL / 10n })).mint;
});

/** Runs a test body with the server pointed at an address where nothing listens. */
async function withDeadChain<T>(body: () => Promise<T>): Promise<T> {
  process.env.LOCAL_RPC_URL = "http://127.0.0.1:1";
  process.env.RPC_TIMEOUT_MS = "1500";
  try {
    return await body();
  } finally {
    process.env.LOCAL_RPC_URL = RPC_URL;
    delete process.env.RPC_TIMEOUT_MS;
  }
}

describe("crediting a deposit", () => {
  it("credits once when many requests ask at the same moment", async () => {
    // Send the deposit straight to the chain, so the server has not seen it, then race five credits.
    const built = await call("ring/deposit/build", { wallet: holder.address, mint: NATIVE, amount: SOL.toString() });
    const signed = VersionedTransaction.deserialize(fromBase64(signTransaction(built.transaction, [holder.wallet.seed])));
    const signature = await chain.sendRawTransaction(signed.serialize());
    await chain.confirmTransaction(signature, "confirmed");
    const results = await Promise.all(Array.from({ length: 5 }, () => call("ring/credit", { signature })));
    expect(results.filter((result) => result.credited.length > 0)).toHaveLength(1);
    expect(await holder.ringBalance(NATIVE)).toBe(SOL);
    await expectCovered(NATIVE);
  });

  it("is done by the server when it submits the transaction, so a browser that vanishes loses nothing", async () => {
    const before = await holder.ringBalance(NATIVE);
    const built = await call("ring/deposit/build", { wallet: holder.address, mint: NATIVE, amount: (SOL / 4n).toString() });
    // The browser's only call. It never comes back to ask for the credit.
    await call("tx/send", { transaction: signTransaction(built.transaction, [holder.wallet.seed]) });
    expect(await holder.ringBalance(NATIVE)).toBe(before + SOL / 4n);
  });

  it("recovers a deposit the server never heard about", async () => {
    const before = await holder.ringBalance(mint);
    const built = await call("ring/deposit/build", { wallet: holder.address, mint, amount: "7000000" });
    const signed = VersionedTransaction.deserialize(fromBase64(signTransaction(built.transaction, [holder.wallet.seed])));
    await chain.confirmTransaction(await chain.sendRawTransaction(signed.serialize()), "confirmed");
    expect(await holder.ringBalance(mint)).toBe(before); // on-chain, but not yet in the ledger
    restartServer();
    const found = await call("ring/reconcile");
    expect(found.credited).toBe(1);
    expect(await holder.ringBalance(mint)).toBe(before + 7_000_000n);
    expect((await call("ring/reconcile")).credited).toBe(0); // and only once
    await expectCovered(mint);
  });

  it("only ever credits the wallet that paid, whoever asks", async () => {
    const sent = await holder.deposit(NATIVE, SOL / 10n);
    const thief = new RingClient(call, newActor());
    expect((await call("ring/credit", { signature: sent.signature })).credited).toEqual([]);
    expect(await thief.ringBalance(NATIVE)).toBe(0n);
  });
});

describe("a withdrawal whose outcome is uncertain", () => {
  it("gives the coins back when the payout was certainly never sent", async () => {
    const before = await holder.ringBalance(NATIVE);
    await withDeadChain(async () => {
      await expect(holder.withdraw(NATIVE, SOL / 10n)).rejects.toThrow(/the chain is not answering\. Nothing was sent/);
    });
    expect(await holder.ringBalance(NATIVE)).toBe(before);
    expect((await holder.ringHistory()).some((event) => event.pending)).toBe(false);
  });

  it("holds the coins while a sent payout is unconfirmed, then settles it from the chain: landed", async () => {
    // A real payout that landed, recorded as if the server had lost contact right after sending it.
    const before = await holder.ringBalance(NATIVE);
    const result = await holder.withdraw(NATIVE, SOL / 10n);
    const event = state().events.find((candidate) => candidate.id === result.event.id)!;
    event.pending = true;
    state().pendingPayouts.push({ eventId: event.id, signature: result.signature, lastValidBlockHeight: (await chain.getBlockHeight()) + 100 });
    expect((await call("ring/reconcile")).payoutsResolved).toBe(1);
    expect(await holder.ringBalance(NATIVE)).toBe(before - SOL / 10n - PAYOUT_FEE_LAMPORTS); // paid out once, debited once, with its fee
    expect(state().events.find((candidate) => candidate.id === event.id)!.pending).toBeUndefined();
    expect(state().pendingPayouts).toEqual([]);
  });

  it("and gives them back, once, when the chain shows the payout never landed", async () => {
    const before = await holder.ringBalance(NATIVE);
    const event = ring.debitForWithdrawal(holder.address, NATIVE, SOL / 10n, holder.address);
    state().pendingPayouts.push({ eventId: event.id, signature: unknownSignature(), lastValidBlockHeight: 1 }); // its window closed long ago
    expect(await holder.ringBalance(NATIVE)).toBe(before - SOL / 10n);
    expect((await call("ring/reconcile")).payoutsResolved).toBe(1);
    expect(await holder.ringBalance(NATIVE)).toBe(before);
    ring.undoWithdrawal(event.id); // a second undo must do nothing
    expect(await holder.ringBalance(NATIVE)).toBe(before);
    await expectCovered(NATIVE);
  });

  it("puts a payout on record before sending it, and treats a send that may have gone through as unknown, not as refused", async () => {
    // A node that takes the connection and never answers: the transaction may or may not have reached the chain.
    const silent = createServer((socket) => socket.on("data", () => undefined)).listen(0, "127.0.0.1");
    await new Promise((resolve) => silent.once("listening", resolve));
    const before = await holder.ringBalance(NATIVE);
    const destination = newActor().address;
    const cost = await payoutCost(destination, NATIVE);
    const event = ring.debitForWithdrawal(holder.address, NATIVE, SOL / 100n, destination, cost.lamports);
    const prepared = await preparePayout(destination, NATIVE, SOL / 100n, cost.opensAccount);
    state().pendingPayouts.push({ eventId: event.id, signature: prepared.signature, lastValidBlockHeight: prepared.lastValidBlockHeight });
    process.env.LOCAL_RPC_URL = `http://127.0.0.1:${(silent.address() as AddressInfo).port}`;
    process.env.RPC_TIMEOUT_MS = "700";
    try {
      expect(await sendPayout(prepared)).toEqual({ status: "unknown", signature: prepared.signature, lastValidBlockHeight: prepared.lastValidBlockHeight });
    } finally {
      process.env.LOCAL_RPC_URL = RPC_URL;
      delete process.env.RPC_TIMEOUT_MS;
      silent.close();
    }
    // Nothing is given back on a guess: the coins stay out of the balance until the chain says which it was.
    expect(await holder.ringBalance(NATIVE)).toBe(before - SOL / 100n - cost.lamports);
    // Here it never reached the chain. Once its window has closed, that is certain, and the coins and the fee come back.
    state().pendingPayouts[state().pendingPayouts.length - 1]!.lastValidBlockHeight = 1;
    expect((await call("ring/reconcile")).payoutsResolved).toBe(1);
    expect(await holder.ringBalance(NATIVE)).toBe(before);
    expect(await onChain(destination, NATIVE)).toBe(0n);
    // A refusal before broadcast is the one case that is certain at once: a payout that fails its simulation is not sent.
    const tooMuch = await preparePayout(destination, NATIVE, 10_000n * SOL, false);
    expect((await sendPayout(tooMuch)).status).toBe("not-sent");
  });

  it("gives the coins back for a withdrawal that was taken out of the balance but never got as far as a payout", async () => {
    // As after a crash between the two steps: debited and stored, with no payout on record.
    const before = await holder.ringBalance(NATIVE);
    const event = ring.debitForWithdrawal(holder.address, NATIVE, SOL / 100n, holder.address, PAYOUT_FEE_LAMPORTS);
    restartServer();
    expect(await holder.ringBalance(NATIVE)).toBe(before - SOL / 100n - PAYOUT_FEE_LAMPORTS);
    expect((await call("ring/reconcile")).payoutsResolved).toBe(1);
    expect(await holder.ringBalance(NATIVE)).toBe(before);
    expect((await holder.ringHistory()).some((seen) => seen.id === event.id)).toBe(false);
    // One that is being prepared at this very moment is left alone.
    const live = ring.debitForWithdrawal(holder.address, NATIVE, 1_000n, holder.address, PAYOUT_FEE_LAMPORTS);
    preparing.add(live.id);
    expect((await call("ring/reconcile")).payoutsResolved).toBe(0);
    preparing.delete(live.id);
    ring.undoWithdrawal(live.id);
    expect(await holder.ringBalance(NATIVE)).toBe(before);
  });

  it("leaves a payout pending while the chain cannot be asked", async () => {
    const event = ring.debitForWithdrawal(holder.address, NATIVE, 1_000n, holder.address);
    state().pendingPayouts.push({ eventId: event.id, signature: unknownSignature(), lastValidBlockHeight: 1 });
    // The first thing reconcile does is ask the chain; with no chain it must fail without touching the ledger.
    await withDeadChain(async () => {
      await expect(call("ring/reconcile")).rejects.toThrow(/chain is not answering/);
    });
    expect(state().pendingPayouts).toHaveLength(1);
    await call("ring/reconcile");
    expect(state().pendingPayouts).toEqual([]);
  });
});

describe("a dead or slow chain", () => {
  it("answers every chain operation quickly with one clear sentence, and changes nothing", async () => {
    const ringBefore = await holder.ringBalance(mint);
    const started = Date.now();
    await withDeadChain(async () => {
      for (const attempt of [
        () => call("explore"),
        () => call("wallet/public", { wallet: holder.address }),
        () => call("launch/build", { wallet: holder.address, mint: newActor().address, name: "X", symbol: "X" }),
        () => call("trade/build", { wallet: holder.address, mint, side: "buy", amount: "1000000" }),
        () => call("ring/deposit/build", { wallet: holder.address, mint, amount: "1" }),
        () => call("fees/claimable", { wallet: holder.address }),
        () => call("tx/status", { signature: unknownSignature() }),
      ]) {
        await expect(attempt()).rejects.toThrow(/^the chain is not answering\. Nothing was sent\. Try again in a moment\.$/);
      }
      const status = await call("status");
      expect(status.chain.reachable).toBe(false);
      expect(status.chain.problem).toMatch(/not answering/);
    });
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(await holder.ringBalance(mint)).toBe(ringBefore);
  });

  it("still serves what needs no chain: Ring balances and transfers", async () => {
    const friend = await fundedClient();
    await friend.register();
    await holder.deposit(mint, 1_000_000n);
    await withDeadChain(async () => {
      expect(await holder.ringBalance(mint)).toBeGreaterThanOrEqual(1_000_000n);
      await holder.transfer(friend.address, mint, 1_000n);
    });
    expect(await friend.ringBalance(mint)).toBe(1_000n);
  });

  it("reports a healthy chain and full cover on the status operation", async () => {
    const status = await call("status");
    expect(status.chain).toMatchObject({ reachable: true });
    expect(status.programs.map((program) => program.present)).toEqual([true, true, true]);
    expect(status.launchTable).toBe(true);
    expect(status.escrow.length).toBeGreaterThan(0);
    expect(status.escrow.every((row) => row.covered)).toBe(true);
  });
});

describe("transactions", () => {
  it("an expired, unsigned, altered or meaningless transaction is refused with a reason and moves nothing", async () => {
    const before = await onChain(holder.address, NATIVE);
    const built = await call("ring/deposit/build", { wallet: holder.address, mint: NATIVE, amount: SOL.toString() });
    await expect(call("tx/send", { transaction: built.transaction })).rejects.toThrow(); // never signed
    await expect(call("tx/send", { transaction: "not base64 at all" })).rejects.toThrow(/not a signed transaction/);
    const wrongKey = signTransaction.bind(null, built.transaction, [newActor().seed]);
    expect(wrongKey).toThrow(/does not ask for that key's signature/);
    const signed = fromBase64(signTransaction(built.transaction, [holder.wallet.seed]));
    signed[signed.length - 1]! ^= 1; // one bit changed after signing
    await expect(call("tx/send", { transaction: Buffer.from(signed).toString("base64") })).rejects.toThrow();
    expect(await onChain(holder.address, NATIVE)).toBe(before);
  });

  it("the same signed transaction cannot be sent twice for a second credit", async () => {
    const before = await holder.ringBalance(NATIVE);
    const built = await call("ring/deposit/build", { wallet: holder.address, mint: NATIVE, amount: (SOL / 20n).toString() });
    const signed = signTransaction(built.transaction, [holder.wallet.seed]);
    await call("tx/send", { transaction: signed });
    await expect(call("tx/send", { transaction: signed })).rejects.toThrow(/already/);
    expect(await holder.ringBalance(NATIVE)).toBe(before + SOL / 20n);
  });
});

describe("signed requests", () => {
  const sign = (client: RingClient, op: string, payload: object, at?: number) =>
    signRequest(op, client.address, payload, (message) => signMessage(client.wallet, message), at);

  it("rejects a forged, replayed, stale, mislabelled or edited request", async () => {
    const thief = new RingClient(call, newActor());
    const forged = await signRequest("ring/withdraw", holder.address, { mint: NATIVE, amount: "1" }, (message) => signMessage(thief.wallet, message));
    await expect(call("ring/withdraw", forged)).rejects.toThrow(/does not match the wallet/);
    const once = await sign(holder, "ring/mine", {});
    await call("ring/mine", once);
    await expect(call("ring/mine", once)).rejects.toThrow(/already used/);
    await expect(call("ring/mine", await sign(holder, "ring/mine", {}, Date.now() - 600_000))).rejects.toThrow(/too old/);
    await expect(call("ring/withdraw", await sign(holder, "ring/mine", { mint: NATIVE, amount: "1" }))).rejects.toThrow(/different action/);
    await expect(call("ring/mine", { body: { wallet: holder.address } })).rejects.toThrow(/must be signed/);
    const edited = await sign(holder, "ring/transfer", { to: thief.address, mint: NATIVE, amount: "1" });
    (edited.body as unknown as { amount: string }).amount = "999999999";
    await expect(call("ring/transfer", edited)).rejects.toThrow(/does not match the wallet/);
  });

  it("a used request stays used after the server restarts", async () => {
    const once = await sign(holder, "ring/mine", {});
    await call("ring/mine", once);
    restartServer();
    await expect(call("ring/mine", once)).rejects.toThrow(/already used/);
  });
});

describe("the local faucet", () => {
  it("pays every request: back to back and at the same moment, the chain gains 10 SOL each time", async () => {
    const wallet = newActor().address;
    await call("faucet", { wallet });
    await call("faucet", { wallet });
    expect(await onChain(wallet, NATIVE)).toBe(20n * SOL);
    await Promise.all([call("faucet", { wallet }), call("faucet", { wallet }), call("faucet", { wallet })]);
    expect(await onChain(wallet, NATIVE)).toBe(50n * SOL);
  });
});

describe("the mock stays local", () => {
  it("refuses to run against anything but a local validator, at the door and again underneath", async () => {
    const wallet = new RingClient(call, newActor());
    process.env.LOCAL_RPC_URL = "https://api.devnet.solana.com";
    try {
      // At the door: every request that touches a Ring balance is turned away.
      await expect(wallet.register()).rejects.toThrow(/not connected on this network/);
      await expect(call("faucet", { wallet: wallet.address })).rejects.toThrow(/local-validator mock/);
      // Underneath: the ledger and the escrow key refuse by themselves, whoever calls them.
      expect(() => ring.register(wallet.address)).toThrow(/local-validator mock/);
      expect(() => ring.transfer(wallet.address, holder.address, NATIVE, 1n)).toThrow(/local-validator mock/);
      expect(() => escrow()).toThrow(/local-validator mock/);
    } finally {
      process.env.LOCAL_RPC_URL = RPC_URL;
    }
    process.env.RING_NETWORK = "devnet";
    process.env.DEVNET_RPC_URL = RPC_URL; // devnet mode, even when pointed at this machine, has no stand-in
    try {
      await expect(wallet.register()).rejects.toThrow(/not connected on this network/);
      expect(() => ring.register(wallet.address)).toThrow(/local-validator mock/);
      expect(() => escrow()).toThrow(/local-validator mock/);
    } finally {
      process.env.RING_NETWORK = "local";
      delete process.env.DEVNET_RPC_URL;
    }
  });
});
