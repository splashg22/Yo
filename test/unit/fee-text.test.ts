import { describe, expect, it } from "vitest";
import { feeText } from "../../lib/fee-text";

const WALLET = "FeeWa11etFeeWa11etFeeWa11etFeeWa11etFeeWa11e";
const off = { wallet: "", tradeBps: 0, launchLamports: "0", otcBps: 0 };
const on = { wallet: WALLET, tradeBps: 50, launchLamports: "20000000", otcBps: 25 };

describe("the fee sentence at the confirm step", () => {
  it("says nothing when no fee is charged, whatever the action", () => {
    for (const action of ["curve-trade", "launch", "otc", "deposit"]) expect(feeText(action, off)).toBe("");
    // A rate without a wallet to pay is not a fee, and a wallet with every rate at zero charges nothing.
    expect(feeText("curve-trade", { ...on, wallet: "" })).toBe("");
    expect(feeText("curve-trade", { ...off, wallet: WALLET })).toBe("");
  });

  it("states the rate, who pays, and that the payment is public", () => {
    expect(feeText("curve-trade", on)).toMatch(
      /^This site's fee: 0\.5% of the trade, paid in SOL by the trading wallet\. It is a public transfer to FeeW…a11e/,
    );
    expect(feeText("launch", on)).toMatch(/0\.02 SOL for the launch, paid by the creator/);
    expect(feeText("otc", on)).toMatch(/0\.25% of the price, paid by the buyer on top of it/);
    expect(feeText("otc", { ...on, otcBps: 300 })).toMatch(/3% of the price/);
  });

  it("charges nothing for actions that have no fee", () => {
    for (const action of ["deposit", "transfer", "withdraw", "pay"]) expect(feeText(action, on)).toBe("");
  });
});
