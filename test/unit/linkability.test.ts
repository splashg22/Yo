import { describe, expect, it } from "vitest";
import type { RingEvent } from "../../lib/contract";
import { withdrawalWarnings } from "../../lib/linkability";

const ME = "Mara1111111111111111111111111111111111111111";
const COIN = "Coin1111111111111111111111111111111111111111";
const NOW = 10_000_000;
const deposit = (amount: string, minutesAgo: number, coin = COIN, wallet = ME): RingEvent => ({
  id: `${amount}-${minutesAgo}`,
  at: NOW - minutesAgo * 60_000,
  kind: "deposit",
  public: { wallet, coin, amount },
  sealed: {},
  parties: [wallet],
});

describe("warnings before a withdrawal that is easy to link to a deposit", () => {
  it("says nothing when there is nothing to link: no deposit of this coin by this wallet", () => {
    expect(withdrawalWarnings([], { wallet: ME, mint: COIN, amount: 5n }, NOW)).toEqual([]);
    expect(withdrawalWarnings([deposit("5", 1, "OtherCoin"), deposit("5", 1, COIN, "SomeoneElse")], { wallet: ME, mint: COIN, amount: 5n }, NOW)).toEqual([]);
  });

  it("warns when the amount is exactly a deposit's, however long ago, and not when it differs by one unit", () => {
    const history = [deposit("1000000", 5000)];
    const elsewhere = { wallet: ME, mint: COIN, destination: "Fresh111111111111111111111111111111111111111" };
    expect(withdrawalWarnings(history, { ...elsewhere, amount: 1_000_000n }, NOW)).toEqual([expect.stringMatching(/exactly the amount of a deposit/)]);
    expect(withdrawalWarnings(history, { ...elsewhere, amount: 999_999n }, NOW)).toEqual([]);
  });

  it("warns when the last deposit was within the hour, with the minutes, and not after", () => {
    const elsewhere = { wallet: ME, mint: COIN, amount: 7n, destination: "Fresh111111111111111111111111111111111111111" };
    expect(withdrawalWarnings([deposit("10", 12)], elsewhere, NOW)).toEqual([expect.stringMatching(/12 minutes ago/)]);
    expect(withdrawalWarnings([deposit("10", 0)], elsewhere, NOW)).toEqual([expect.stringMatching(/1 minute ago/)]);
    expect(withdrawalWarnings([deposit("10", 61)], elsewhere, NOW)).toEqual([]);
  });

  it("warns when the coins go back to the wallet that deposited, named or left blank", () => {
    const old = [deposit("10", 500)];
    for (const destination of [undefined, "", ME])
      expect(withdrawalWarnings(old, { wallet: ME, mint: COIN, amount: 3n, destination }, NOW)).toEqual([expect.stringMatching(/round trip/)]);
  });

  it("gives all three together for the most linkable withdrawal there is", () => {
    expect(withdrawalWarnings([deposit("10", 2)], { wallet: ME, mint: COIN, amount: 10n }, NOW)).toHaveLength(3);
  });
});
