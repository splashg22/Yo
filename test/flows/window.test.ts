/**
 * The sealed launch window, with its feature flag on. It holds buyers' funds, so the checks
 * here are about money: what is committed is exactly what is held, what is bought is exactly
 * what is shared out, and nothing can be changed while a launch may still land.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NATIVE } from "../../lib/constants";
import { newActor } from "../../lib/keys";
import type { RingClient } from "../../lib/sdk";
import { ring } from "../../lib/server/ring";
import { state } from "../../lib/server/store";
import { WINDOW_CAP_LAMPORTS } from "../../lib/server/windows";
import { signTransaction } from "../../lib/sign";
import { signRequest } from "../../lib/auth";
import { signMessage } from "../../lib/keys";
import { SOL, call, chain, escrowOnChain, expectCovered, freshServer, fundedClient, onChain, restartServer } from "./helpers";

freshServer();
let creator: RingClient, mara: RingClient, ilya: RingClient, noor: RingClient;
const closeNow = (id: string) => (state().windows.find((window) => window.id === id)!.closesAt = Date.now() - 1); // as if its hours had passed
const committed = (id: string) => BigInt(state().balances[`window:${id}`]?.[NATIVE] ?? "0");

beforeAll(async () => {
  process.env.FEATURE_SEALED_WINDOW = "on";
  [creator, mara, ilya, noor] = await Promise.all([fundedClient(), fundedClient(), fundedClient(), fundedClient()]);
  for (const person of [mara, ilya, noor]) await person.deposit(NATIVE, SOL);
});
afterAll(() => delete process.env.FEATURE_SEALED_WINDOW);

describe("switched off", () => {
  it("refuses every window operation, and says so in the site's settings", async () => {
    process.env.FEATURE_SEALED_WINDOW = "off";
    try {
      expect((await call("config", {})).features.sealedWindow).toBe(false);
      await expect(call("window/list", {})).rejects.toThrow(/switched off/);
      await expect(creator.openWindow({ name: "Lantern", symbol: "LNT", hours: 1 })).rejects.toThrow(/switched off/);
      await expect(mara.commitToWindow("anything", 1n)).rejects.toThrow(/switched off/);
      await expect(mara.uncommitFromWindow("anything")).rejects.toThrow(/switched off/);
      await expect(creator.cancelWindow("anything")).rejects.toThrow(/switched off/);
      await expect(creator.launchWindow("anything")).rejects.toThrow(/switched off/);
    } finally {
      process.env.FEATURE_SEALED_WINDOW = "on";
    }
    expect((await call("config", {})).features.sealedWindow).toBe(true);
  });
});

describe("a window from opening to launch", () => {
  it("holds exactly what is committed, buys with all of it in the coin's first transaction, and shares the coins out to the base unit", async () => {
    const window = await creator.openWindow({ name: "Sealed Lantern", symbol: "SEAL", description: "Launched from a sealed window.", hours: 2 });
    const before = {
      mara: await mara.ringBalance(NATIVE),
      ilya: await ilya.ringBalance(NATIVE),
      noor: await noor.ringBalance(NATIVE),
      owed: ring.total(NATIVE),
    };
    await mara.commitToWindow(window.id, SOL / 5n); // 0.2
    await ilya.commitToWindow(window.id, SOL / 10n); // 0.1
    await noor.commitToWindow(window.id, SOL / 20n);
    await noor.uncommitFromWindow(window.id); // changes her mind: all of it comes back
    expect(await noor.ringBalance(NATIVE)).toBe(before.noor);
    expect(await mara.ringBalance(NATIVE)).toBe(before.mara - SOL / 5n);
    expect(committed(window.id)).toBe((SOL * 3n) / 10n);
    // Committing moves SOL inside the ledger: what the ledger owes in total has not changed, and escrow still covers it.
    expect(ring.total(NATIVE)).toBe(before.owed);
    await expectCovered(NATIVE);

    // What the public can see: how many committed and the total. Not who put in what.
    const listed = (await call("window/list", {})).windows.find((seen) => seen.id === window.id)!;
    expect(listed).toMatchObject({ committers: 2, totalLamports: ((SOL * 3n) / 10n).toString(), status: "open" });
    expect(JSON.stringify(listed)).not.toContain(mara.address);

    await expect(creator.launchWindow(window.id)).rejects.toThrow(/still open to commitments/);
    closeNow(window.id);
    await expect(noor.commitToWindow(window.id, 1n)).rejects.toThrow(/closed to new commitments/);

    const escrowSolBefore = await escrowOnChain(NATIVE);
    const creatorCoinsBefore = await creator.ringBalance(NATIVE);
    const launched = await creator.launchWindow(window.id);
    const spent = escrowSolBefore - (await escrowOnChain(NATIVE));
    const received = await escrowOnChain(launched.mint);
    expect(received).toBeGreaterThan(0n);
    expect(spent).toBeGreaterThan(0n);
    expect(spent).toBeLessThanOrEqual((SOL * 3n) / 10n); // escrow never spends more than was committed

    // The coin's very first transaction is the one that bought for the window: nobody could have bought before it.
    const firstOnCurve = (await call("coin/activity", { mint: launched.mint })).activity.at(-1)!;
    expect(firstOnCurve.signature).toBe(launched.signature);

    // Coins: two thirds and one third, rounded down, the odd base units to the larger committer. Every unit is someone's.
    const maraCoins = await mara.ringBalance(launched.mint);
    const ilyaCoins = await ilya.ringBalance(launched.mint);
    expect(ilyaCoins).toBe(received / 3n);
    expect(maraCoins).toBe(received - received / 3n);
    expect(await creator.ringBalance(launched.mint)).toBe(0n); // the creator paid the fee and committed nothing: the coins are not theirs
    expect(await onChain(creator.address, launched.mint)).toBe(0n);
    await expectCovered(launched.mint);

    // SOL: what was not spent came back in the same proportion. The ledger's total fell by exactly what escrow spent on-chain.
    const leftover = (SOL * 3n) / 10n - spent;
    expect(await ilya.ringBalance(NATIVE)).toBe(before.ilya - SOL / 10n + leftover / 3n);
    expect(await mara.ringBalance(NATIVE)).toBe(before.mara - SOL / 5n + (leftover - leftover / 3n));
    expect(committed(window.id)).toBe(0n);
    expect(ring.total(NATIVE)).toBe(before.owed - spent);
    expect(await creator.ringBalance(NATIVE)).toBe(creatorCoinsBefore);
    await expectCovered(NATIVE);

    const after = (await call("window/list", {})).windows.find((seen) => seen.id === window.id)!;
    expect(after).toMatchObject({ status: "launched", mint: launched.mint, signature: launched.signature, committers: 0, totalLamports: "0" });
    expect((await call("coin", { mint: launched.mint })).name).toBe("Sealed Lantern");
    const history = (await mara.ringHistory()).filter((event) => event.kind === "window");
    expect(history.map((event) => event.sealed.did)).toEqual(["filled", "committed"]); // newest first
    // A launched window cannot be launched, committed to or cancelled again.
    await expect(creator.launchWindow(window.id)).rejects.toThrow(/launched/);
    await expect(mara.commitToWindow(window.id, 1n)).rejects.toThrow(/launched/);
    await expect(creator.cancelWindow(window.id)).rejects.toThrow(/already launched/);
  });
});

describe("the rules of a window", () => {
  it("refuses what it should, and moves nothing when it refuses", async () => {
    const window = await creator.openWindow({ name: "Rules", symbol: "RULE", hours: 1 });
    const before = await mara.ringBalance(NATIVE);
    await expect(mara.commitToWindow(window.id, 0n)).rejects.toThrow(/above zero/);
    await expect(creator.commitToWindow(window.id, 1n)).rejects.toThrow(/Ring balance is too low/); // the creator holds no SOL in the Ring
    await expect(mara.commitToWindow(window.id, WINDOW_CAP_LAMPORTS + 1n)).rejects.toThrow(/over its limit|too low/);
    await expect(mara.commitToWindow("no-such-window", 1n)).rejects.toThrow(/does not exist/);
    await expect(mara.uncommitFromWindow(window.id)).rejects.toThrow(/nothing committed/);
    await expect(mara.cancelWindow(window.id)).rejects.toThrow(/not your window/);
    await expect(creator.openWindow({ name: "Bad", symbol: "BAD", hours: 0 })).rejects.toThrow(/1 to 72 whole hours/);
    await expect(creator.openWindow({ name: "Bad", symbol: "BAD", hours: 1.5 })).rejects.toThrow(/1 to 72 whole hours/);
    await expect(creator.openWindow({ name: "Bad", symbol: "not a ticker", hours: 1 })).rejects.toThrow(/ticker/);
    expect(await mara.ringBalance(NATIVE)).toBe(before);

    await mara.commitToWindow(window.id, 1_000_000n); // far too little to launch
    closeNow(window.id);
    await expect(mara.launchWindow(window.id)).rejects.toThrow(/not your window/);
    await expect(creator.launchWindow(window.id)).rejects.toThrow(/too little is committed/);
    // A closed window that never launches: each committer can still take their own back, with no help from the creator.
    await mara.uncommitFromWindow(window.id);
    expect(await mara.ringBalance(NATIVE)).toBe(before);
  });

  it("returns every commitment, to the lamport, when the creator cancels", async () => {
    const window = await creator.openWindow({ name: "Called off", symbol: "OFF", hours: 1 });
    const before = { mara: await mara.ringBalance(NATIVE), ilya: await ilya.ringBalance(NATIVE), owed: ring.total(NATIVE) };
    await mara.commitToWindow(window.id, 123_456_789n);
    await ilya.commitToWindow(window.id, 1n);
    await mara.commitToWindow(window.id, 11n); // a second commitment adds to the first
    await creator.cancelWindow(window.id);
    expect(await mara.ringBalance(NATIVE)).toBe(before.mara);
    expect(await ilya.ringBalance(NATIVE)).toBe(before.ilya);
    expect(committed(window.id)).toBe(0n);
    expect(ring.total(NATIVE)).toBe(before.owed);
    await expect(mara.commitToWindow(window.id, 1n)).rejects.toThrow(/cancelled/);
    await expectCovered(NATIVE);
  });
});

describe("while a launch may still land", () => {
  it("locks the window, settles it from the chain if the browser never reports back, and survives a restart", async () => {
    const window = await creator.openWindow({ name: "Locked", symbol: "LOCK", hours: 1 });
    await mara.commitToWindow(window.id, SOL / 10n);
    await ilya.commitToWindow(window.id, SOL / 10n);
    closeNow(window.id);
    const coin = newActor();
    const sign = (name: string, payload: object) => signRequest(name, creator.address, payload, (message) => signMessage(creator.wallet, message));
    const built = await call("window/launch/build", await sign("window/launch/build", { id: window.id, mint: coin.address }));

    // The transaction is out: until it lands or expires, the pool cannot change under it.
    await expect(mara.uncommitFromWindow(window.id)).rejects.toThrow(/launching/);
    await expect(noor.commitToWindow(window.id, 1n)).rejects.toThrow(/launching/);
    await expect(creator.cancelWindow(window.id)).rejects.toThrow(/launching/);
    await expect(call("window/launch/build", await sign("window/launch/build", { id: window.id, mint: newActor().address }))).rejects.toThrow(
      /already under way/,
    );

    // The creator's browser sends it straight to the chain and vanishes; the server is restarted before it hears anything.
    const signed = signTransaction(built.transaction, [creator.wallet.seed, coin.seed]);
    const signature = await chain.sendRawTransaction(Buffer.from(signed, "base64"));
    await chain.confirmTransaction(signature, "confirmed");
    restartServer();
    expect((await call("window/list", {})).windows.find((seen) => seen.id === window.id)!.status).toBe("launching");
    await call("ring/reconcile", {});
    expect((await call("window/list", {})).windows.find((seen) => seen.id === window.id)!).toMatchObject({ status: "launched", mint: coin.address });
    const received = await escrowOnChain(coin.address);
    expect((await mara.ringBalance(coin.address)) + (await ilya.ringBalance(coin.address))).toBe(received);
    await expectCovered(coin.address);
    await expectCovered(NATIVE);
    // Settling the same transaction again changes nothing.
    await call("ring/credit", { signature });
    expect((await mara.ringBalance(coin.address)) + (await ilya.ringBalance(coin.address))).toBe(received);
  });

  it("unlocks by itself once a launch that was never sent can no longer land", { timeout: 240_000 }, async () => {
    const window = await creator.openWindow({ name: "Lapsed", symbol: "LAPS", hours: 1 });
    await mara.commitToWindow(window.id, SOL / 10n);
    closeNow(window.id);
    const before = await mara.ringBalance(NATIVE);
    await call(
      "window/launch/build",
      await signRequest("window/launch/build", creator.address, { id: window.id, mint: newActor().address }, (message) => signMessage(creator.wallet, message)),
    );
    await expect(mara.uncommitFromWindow(window.id)).rejects.toThrow(/launching/);
    // The creator never signs it. Once its blockhash is too old for the chain to accept, nothing can land any more.
    const expires = state().windows.find((seen) => seen.id === window.id)!.launching!.lastValidBlockHeight;
    while ((await chain.getBlockHeight("confirmed")) <= expires) await new Promise((resolve) => setTimeout(resolve, 2000));
    await mara.uncommitFromWindow(window.id);
    expect(await mara.ringBalance(NATIVE)).toBe(before + SOL / 10n);
    expect((await call("window/list", {})).windows.find((seen) => seen.id === window.id)!.status).toBe("open");
    await expectCovered(NATIVE);
  });

  it("refuses a launch transaction that was altered after the stand-in signed it", async () => {
    const window = await creator.openWindow({ name: "Altered", symbol: "ALT", hours: 1 });
    await mara.commitToWindow(window.id, SOL / 10n);
    closeNow(window.id);
    const coin = newActor();
    const built = await call(
      "window/launch/build",
      await signRequest("window/launch/build", creator.address, { id: window.id, mint: coin.address }, (message) => signMessage(creator.wallet, message)),
    );
    const bytes = Buffer.from(signTransaction(built.transaction, [creator.wallet.seed, coin.seed]), "base64");
    bytes[bytes.length - 9]! ^= 1; // one bit of the last instruction's data
    await expect(call("tx/send", { transaction: bytes.toString("base64") })).rejects.toThrow();
    expect(await escrowOnChain(coin.address)).toBe(0n);
    expect(committed(window.id)).toBe(SOL / 10n);
  });
});
