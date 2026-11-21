/** The mock Ring's ledger on its own: no chain involved. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { newActor } from "../../lib/keys";
import { ring } from "../../lib/server/ring";
import { forget, state } from "../../lib/server/store";

const COIN = newActor().address,
  SOL = newActor().address;
let ana: string, ben: string;
beforeEach(() => {
  process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "ring-ledger-"));
  process.env.RING_NETWORK = "local";
  process.env.LOCAL_RPC_URL = "http://127.0.0.1:8799";
  forget();
  ana = newActor().address;
  ben = newActor().address;
});
const total = (mint: string) => ring.total(mint);

describe("the ledger", () => {
  it("never creates or destroys coins: deposits add, withdrawals remove, everything else conserves", () => {
    ring.credit(ana, COIN, 1_000n, "sig-1");
    ring.credit(ben, SOL, 500n, "sig-2");
    ring.register(ben);
    expect(total(COIN)).toBe(1_000n);
    ring.transfer(ana, ben, COIN, 300n);
    expect(total(COIN)).toBe(1_000n);
    ring.swap(ana, ben, COIN, 200n, SOL, 100n);
    expect([total(COIN), total(SOL)]).toEqual([1_000n, 500n]);
    const withdrawal = ring.debitForWithdrawal(ben, COIN, 400n, ben);
    expect(total(COIN)).toBe(600n);
    ring.undoWithdrawal(withdrawal.id);
    expect(total(COIN)).toBe(1_000n);
    expect(ring.balances(ana)).toEqual({ [COIN]: "500", [SOL]: "100" });
    expect(ring.balances(ben)).toEqual({ [COIN]: "500", [SOL]: "400" });
  });

  it("a withdrawal can be undone once, and not at all once it has landed", () => {
    ring.credit(ana, COIN, 1_000n, "sig-1");
    const first = ring.debitForWithdrawal(ana, COIN, 400n, ana);
    ring.undoWithdrawal(first.id);
    ring.undoWithdrawal(first.id);
    expect(total(COIN)).toBe(1_000n);
    const second = ring.debitForWithdrawal(ana, COIN, 400n, ana);
    ring.completeWithdrawal(second.id, "payout-signature");
    ring.undoWithdrawal(second.id);
    expect(total(COIN)).toBe(600n);
    expect(ring.history(ana).find((event) => event.id === second.id)).toMatchObject({ signature: "payout-signature" });
  });

  it("a swap is all or nothing", () => {
    ring.credit(ana, COIN, 100n, "sig-1");
    ring.credit(ben, SOL, 10n, "sig-2");
    expect(() => ring.swap(ana, ben, COIN, 100n, SOL, 11n)).toThrow(/does not cover the price/);
    expect(() => ring.swap(ana, ben, COIN, 101n, SOL, 10n)).toThrow(/no longer holds the block/);
    expect(ring.balances(ana)).toEqual({ [COIN]: "100" });
    expect(ring.balances(ben)).toEqual({ [SOL]: "10" });
  });

  it("refuses a balance below zero, a zero amount, an unregistered recipient and a transfer to yourself", () => {
    ring.credit(ana, COIN, 5n, "sig-1");
    expect(() => ring.transfer(ana, ben, COIN, 1n)).toThrow(/not registered/);
    ring.register(ben);
    expect(() => ring.transfer(ana, ben, COIN, 6n)).toThrow(/too low/);
    expect(() => ring.transfer(ana, ben, COIN, 0n)).toThrow(/above zero/);
    expect(() => ring.transfer(ana, ana, COIN, 1n)).toThrow(/your own wallet/);
    expect(() => ring.debitForWithdrawal(ana, COIN, 6n, ana)).toThrow(/too low/);
    expect(() => ring.credit(ana, COIN, 0n, "sig-2")).toThrow(/nothing to credit/);
    expect(total(COIN)).toBe(5n);
  });

  it("shows the outside world the wallets of a transfer and nothing else", () => {
    ring.credit(ana, COIN, 50n, "sig-1");
    ring.register(ben);
    ring.transfer(ana, ben, COIN, 20n, "a private note");
    const outside = JSON.stringify(ring.publicView());
    expect(outside).toContain(ana);
    expect(outside).toContain(ben);
    expect(outside).not.toContain("a private note");
    expect(JSON.stringify(ring.publicView(ben))).not.toContain('"sealed"');
    expect(ring.history(newActor().address)).toEqual([]);
    expect(ring.history(ben)[0]!.sealed).toEqual({ coin: COIN, amount: "20", memo: "a private note" });
  });

  it("counts depositors, not holders: a transfer does not add one", () => {
    ring.credit(ana, COIN, 50n, "sig-1");
    ring.credit(ana, COIN, 50n, "sig-2");
    ring.register(ben);
    ring.transfer(ana, ben, COIN, 20n);
    expect(ring.coinStats(COIN)).toEqual({ inRing: 100n, depositors: 1 });
  });

  it("survives a restart exactly", () => {
    ring.credit(ana, COIN, 2n ** 63n, "sig-1");
    const before = JSON.stringify(state());
    forget();
    expect(JSON.stringify(state())).toBe(before);
    expect(ring.balances(ana)[COIN]).toBe((2n ** 63n).toString());
  });
});
