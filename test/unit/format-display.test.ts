/** How figures are shown: dollars beside SOL, tiny prices that can be read, thousands separators, steady decimals, ages. */
import { describe, expect, it } from "vitest";
import {
  compactZeros,
  formatAge,
  formatChange,
  formatCompact,
  formatPrice,
  formatSol,
  formatTokens,
  formatUsd,
  usdOfLamports,
  usdOfPrice,
} from "../../lib/format";

describe("amounts of SOL and of coins", () => {
  it("show as many places as their size deserves, with thousands grouped", () => {
    expect(formatSol(1_234_567_890_000n)).toBe("1,234.5 SOL");
    expect(formatSol(12_345_678_900n)).toBe("12.345 SOL");
    expect(formatSol(1_000_000_000n)).toBe("1 SOL");
    expect(formatSol(123_456_789n)).toBe("0.1234 SOL");
    expect(formatSol(1_234_567n)).toBe("0.001234 SOL");
    expect(formatSol(5_000n)).toBe("0.000005 SOL");
    expect(formatSol(0n)).toBe("0 SOL");
    expect(formatSol(-2_500_000_000n)).toBe("-2.5 SOL");
  });
  it("show exactly the places asked for when a caller asks", () => {
    expect(formatSol(123_456_789n, 9)).toBe("0.123456789 SOL");
    expect(formatSol(1_234_567_890_000n, 2)).toBe("1,234.56 SOL");
  });
  it("size coins the same way", () => {
    expect(formatTokens(34_199_199_131_375n)).toBe("34,199,199.1");
    expect(formatTokens(1_500_000n)).toBe("1.5");
    expect(formatTokens(1_234n)).toBe("0.001234");
  });
});

describe("a tiny price", () => {
  it("is written with the number of zeros as a small figure, so its size can be read", () => {
    expect(compactZeros("0.0000000281")).toBe("0.0₇281");
    expect(compactZeros("0.000012345678")).toBe("0.0₄1234");
    expect(compactZeros("-0.00000005")).toBe("-0.0₇5");
    expect(compactZeros("0.0000000000001")).toBe("0.0₁₂1");
  });
  it("is left alone when it has fewer than four zeros after the point, or is not small at all", () => {
    for (const plain of ["0.000281", "0.5", "12.5", "0", "1,234.5"]) expect(compactZeros(plain)).toBe(plain);
  });
  it("is how a coin's price in SOL is shown, with every digit available on request", () => {
    // 28,000 millionths of a lamport for one coin is 0.000000000028 SOL.
    expect(formatPrice(28_000n)).toBe("0.0₁₀28 SOL");
    expect(formatPrice(28_103_412n)).toBe("0.0₇281 SOL");
    expect(formatPrice(28_103_412n, true)).toBe("0.000000028103412 SOL");
    expect(formatPrice(1_500_000_000_000_000n)).toBe("1.5 SOL");
  });
});

describe("dollars", () => {
  it("show cents above a dollar and three figures below, with thousands grouped", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(70.2129812)).toBe("$70.21");
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(0.12345)).toBe("$0.123");
    expect(formatUsd(0.00456)).toBe("$0.00456");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(-12.5)).toBe("-$12.50");
  });
  it("use the compact form for a tiny figure, and for a large one when asked", () => {
    expect(formatUsd(0.00000197)).toBe("$0.0₅197");
    expect(formatUsd(1_234_567, true)).toBe("$1.23M");
    expect(formatUsd(45_600, true)).toBe("$45.6K");
    expect(formatUsd(9_999, true)).toBe("$9,999.00");
    expect(formatUsd(1_234_567)).toBe("$1,234,567.00");
  });
  it("say nothing rather than something wrong when there is no number", () => {
    expect(formatUsd(Number.NaN)).toBe("");
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe("");
  });
  it("are worked out from lamports and from a coin's price", () => {
    expect(usdOfLamports(1_500_000_000n, 100)).toBe(150);
    expect(usdOfLamports("250000000", 80)).toBe(20);
    // One coin at 28,103,412 millionths of a lamport, with SOL at 70 dollars.
    expect(formatUsd(usdOfPrice(28_103_412n, 70))).toBe("$0.0₅196"); // cut, not rounded up: a figure is never overstated
  });
});

describe("sizes, changes and ages", () => {
  it("shortens large figures and keeps small ones readable", () => {
    expect(formatCompact(1_234_567_890_123)).toBe("1.23T");
    expect(formatCompact(987_654_321)).toBe("988M");
    expect(formatCompact(12_345_678)).toBe("12.3M");
    expect(formatCompact(12_345)).toBe("12.3K");
    expect(formatCompact(9_999)).toBe("9,999");
    expect(formatCompact(12.3456)).toBe("12.35");
    expect(formatCompact(0.0123)).toBe("0.0123");
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(-2_500_000)).toBe("-2.50M");
  });
  it("gives a change two places and a sign, and whole percents once it is past a thousand", () => {
    expect(formatChange(125)).toBe("+1.25%");
    expect(formatChange(-5)).toBe("-0.05%");
    expect(formatChange(0)).toBe("0.00%");
    expect(formatChange(99_999)).toBe("+999.99%");
    expect(formatChange(1_234_567)).toBe("+12,346%");
  });
  it("gives an age the way a trader reads it", () => {
    const now = 1_800_000_000_000;
    expect(formatAge(now - 3_000, now)).toBe("3s");
    expect(formatAge(now - 59_999, now)).toBe("59s");
    expect(formatAge(now - 5 * 60_000, now)).toBe("5m");
    expect(formatAge(now - 2 * 3_600_000, now)).toBe("2h");
    expect(formatAge(now - 4 * 86_400_000, now)).toBe("4d");
    expect(formatAge(now - 800 * 86_400_000, now)).toBe("2y");
    expect(formatAge(now + 5_000, now)).toBe("0s"); // a clock a little ahead is not "in the future"
  });
});
