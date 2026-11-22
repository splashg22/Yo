/**
 * Meteora DAMM v2, read by hand: the decoder is held against two real mainnet swaps, taken on 22 November 2026.
 * For each, what the event is read as must equal what the chain itself recorded: the change in the pool's two coin
 * accounts in that same transaction.
 */
import { describe, expect, it } from "vitest";
import { decodeDamm2, toMillionths, tradeFrom, type Damm2Swap, type PoolFacts } from "../../lib/server/indexer/meteora";
import { eventsInCalls } from "../../lib/server/indexer/decode";
import { priceOf } from "../../lib/server/indexer/model";

const WSOL = "So11111111111111111111111111111111111111112";
/** A swap's event as it was in the transaction: the eight bytes that mark an event call, then the event. */
const BUY = {
  signature: "pLngDXRFEfoWvSdkpf9VXU5fTWCs4S6bfbdSACvaxBcMsg2vy8axXQu7tJGP8mYPJpruWaQG5Q6tT1Z162VHRj5",
  hex: "e445a52e51cb9a1dbd4233a826507599a953ee3c6d346034ddbb87a83b79c2f006d726427d7267153f4af90c00231e9e01000040787d0100000000d27dd0b2020000000040787d010000000040787d01000000000000000000000000636d82e002000000f4a0b035a9d7820b0000000000000000f7fc9600000000003dbf2500000000000000000000000000000000000000000040787d0100000000636d82e002000000636d82e002000000e588026b00000000247b6cc34b2100007583e53b11000000",
  coin: "6iX7VYBWYrDp47Szp1AztUU7rwTFUwEHiX3G1HDyBp3R",
  // What the pool's accounts changed by in that transaction: SOL in, coins out.
  poolSol: 25000000n,
  poolCoins: -12356578659n,
  coinIsA: true,
};
const SELL = {
  signature: "4vaDWq7moLRdxRrby2ETu3SnoidrxY9gjz1UXfa1xgfmQRYbKXMe4CwyNfdvsmCbtfxwNqr35CtRzZo63PC2STzU",
  hex: "e445a52e51cb9a1dbd4233a826507599cfdf714c02b615c53697b2f35ee8433a3cc7f8a6d7cba9ee9b39c84a24a27f2f0101007e332931000000000a80bd69f30300000284f656ee900300006efaf7d69003000000000000000000007e332931000000009a6cb5b6db6ebc1645000000000000004563b21200000000d198ac04000000000000000000000000000000000000000084f656ee900300007e332931000000007e33293100000000e588026b00000000b5c216352e000000973bae05905d0300",
  coin: "38CjKvdtcy2qhBkc8Xhtg86MCkiGh4HpurgcyS4KbkQB",
  poolSol: -824783742n,
  poolCoins: 3921008850564n,
  // In this pool SOL is the first side and the coin the second (read from the pool's own account on mainnet).
  coinIsA: false,
};
const swapOf = (hex: string): Damm2Swap => {
  const found = decodeDamm2(Buffer.from(hex, "hex").subarray(8));
  if (found?.kind !== "damm2-swap") throw new Error("not read as a swap");
  return found;
};
const facts = (swap: Damm2Swap, mint: string, extra: Partial<PoolFacts> = {}): PoolFacts => ({
  pool: swap.pool,
  mint,
  coinIsA: true,
  decimals: 6,
  supply: 1_000_000_000_000_000n,
  quote: WSOL,
  ...extra,
});

describe("a Meteora DAMM v2 swap", () => {
  it("is read as the buy the chain recorded: the SOL the pool gained, the coins it gave", () => {
    const swap = swapOf(BUY.hex);
    const trade = tradeFrom(swap, facts(swap, BUY.coin))!;
    expect(trade.isBuy).toBe(true);
    expect(trade.sol).toBe(BUY.poolSol);
    expect(trade.tokens).toBe(-BUY.poolCoins);
    expect(trade.venue).toBe("damm2");
  });

  it("is read as the sell the chain recorded: the coins the pool gained, the SOL it gave", () => {
    const swap = swapOf(SELL.hex);
    const trade = tradeFrom(swap, facts(swap, SELL.coin, { coinIsA: SELL.coinIsA }))!;
    expect(trade.isBuy).toBe(false);
    expect(trade.tokens).toBe(SELL.poolCoins);
    expect(trade.sol).toBe(-SELL.poolSol);
  });

  it("carries a price that agrees with what the trade itself paid, to within the pool's fee and the trade's own slippage", () => {
    for (const real of [BUY, SELL]) {
      const swap = swapOf(real.hex);
      const trade = tradeFrom(swap, facts(swap, real.coin, { coinIsA: real.coinIsA }))!;
      // Millionths of a lamport for one whole coin, by the same arithmetic every other venue uses.
      const quoted = Number(priceOf(trade.virtualSol, trade.virtualTokens));
      const paid = (Number(trade.sol) / Number(trade.tokens)) * 1e12;
      expect(Math.abs(quoted - paid) / paid, real.signature).toBeLessThan(0.15);
      // And with what the pool holds: these pools hold their liquidity across the whole price range.
      expect(trade.realSol).toBeGreaterThan(0n);
      expect(trade.realTokens).toBeGreaterThan(0n);
    }
  });

  it("is found among a transaction's calls, and nothing else of the program's is mistaken for one", () => {
    const events = eventsInCalls([
      { program: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", data: Buffer.from(BUY.hex, "hex") },
      // The same bytes under another program are not Meteora's.
      { program: "11111111111111111111111111111111", data: Buffer.from(BUY.hex, "hex") },
      // An event of the program's that is not read here.
      { program: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", data: Buffer.concat([Buffer.from("e445a52e51cb9a1d", "hex"), Buffer.alloc(200, 7)]) },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("damm2-swap");
    expect(decodeDamm2(Buffer.from(BUY.hex, "hex").subarray(8, 60))).toBeNull();
  });

  it("is not read as a trade when the pool's other side is not SOL", () => {
    const swap = swapOf(BUY.hex);
    expect(tradeFrom(swap, facts(swap, BUY.coin, { quote: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }))).toBeUndefined();
  });

  it("reads the same swap the other way round when the coin is the pool's second side", () => {
    const swap = swapOf(BUY.hex);
    // Pretend SOL is A and the coin is B: then A to B is SOL in, a buy, and the price is the inverse.
    const mirrored: Damm2Swap = { ...swap, aToB: !swap.aToB, sqrtPrice: (1n << 128n) / swap.sqrtPrice, reserveA: swap.reserveB, reserveB: swap.reserveA };
    const straight = tradeFrom(swap, facts(swap, BUY.coin))!;
    const turned = tradeFrom(mirrored, facts(swap, BUY.coin, { coinIsA: false }))!;
    expect(turned.isBuy).toBe(straight.isBuy);
    expect([turned.sol, turned.tokens, turned.realSol, turned.realTokens]).toEqual([straight.sol, straight.tokens, straight.realSol, straight.realTokens]);
    const [a, b] = [Number(priceOf(straight.virtualSol, straight.virtualTokens)), Number(priceOf(turned.virtualSol, turned.virtualTokens))];
    expect(Math.abs(a - b) / a).toBeLessThan(1e-6);
  });

  it("brings a coin with nine decimals, or two, to the six everything else is held in, price included", () => {
    expect(toMillionths(1_234_567_891n, 9)).toBe(1_234_567n);
    expect(toMillionths(1_234_567n, 6)).toBe(1_234_567n);
    expect(toMillionths(123n, 2)).toBe(1_230_000n);
    const swap = swapOf(BUY.hex);
    const six = tradeFrom(swap, facts(swap, BUY.coin))!;
    // The same bytes read as a nine-decimal coin: a thousand times fewer coins, each worth a thousand times more.
    const nine = tradeFrom(swap, facts(swap, BUY.coin, { decimals: 9 }))!;
    expect(nine.tokens).toBe(six.tokens / 1000n);
    expect(nine.sol).toBe(six.sol);
    const ratio = Number(priceOf(nine.virtualSol, nine.virtualTokens)) / Number(priceOf(six.virtualSol, six.virtualTokens));
    expect(Math.abs(ratio - 1000)).toBeLessThan(0.01);
  });
});
