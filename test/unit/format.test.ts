import { describe, expect, it } from "vitest";
import { U64_MAX } from "../../lib/constants";
import { formatAmount, formatChange, formatPrice, formatShare, formatSol, parseAmount, shortAddress } from "../../lib/format";

describe("amounts in and out", () => {
  it("parses what a person types into whole base units", () => {
    expect(parseAmount("1.5", 9)).toBe(1_500_000_000n);
    expect(parseAmount("0.000001", 6)).toBe(1n);
    expect(parseAmount(".5", 6)).toBe(500_000n);
    expect(parseAmount("1,234.5", 6)).toBe(1_234_500_000n);
    expect(parseAmount("  7  ", 0)).toBe(7n);
    expect(parseAmount("18446744073.709551615", 9)).toBe(U64_MAX);
  });
  it("refuses anything that is not a positive amount the chain can hold", () => {
    for (const bad of ["", " ", ".", "abc", "-1", "1e3", "1.2.3", "0x10", "١٢", "1 000"]) expect(() => parseAmount(bad, 6), bad).toThrow(/enter an amount/);
    expect(() => parseAmount("0", 6)).toThrow(/above zero/);
    expect(() => parseAmount("0.000", 6)).toThrow(/above zero/);
    expect(() => parseAmount("0.0000001", 6)).toThrow(/more than 6 decimal places/);
    expect(() => parseAmount("18446744073.709551616", 9)).toThrow(/larger than the chain can hold/);
    expect(() => parseAmount("9".repeat(31), 0)).toThrow(/enter an amount/);
  });
  it("formats exactly, never through a floating-point number", () => {
    expect(formatAmount(1_500_000_000n, 9)).toBe("1.5");
    expect(formatAmount(1n, 6)).toBe("0.000001");
    expect(formatAmount("123456789012345678", 6)).toBe("123,456,789,012.345678");
    expect(formatAmount(U64_MAX, 9)).toBe("18,446,744,073.709551615");
    expect(formatAmount(0n, 6)).toBe("0");
    expect(formatAmount(-2_500_000n, 6)).toBe("-2.5");
    expect(formatAmount(1_000_000n, 6, 2)).toBe("1");
  });
  it("never shows a positive amount as zero", () => {
    expect(formatAmount(1n, 9, 4)).toBe("<0.0001");
    expect(formatSol(5_000n, 4)).toBe("<0.0001 SOL");
    expect(formatSol(5_000n, 9)).toBe("0.000005 SOL");
  });
  it("round-trips", () => {
    for (const text of ["1", "0.5", "1234567.891", "0.000001"]) expect(formatAmount(parseAmount(text, 6), 6).replace(/,/g, "")).toBe(text);
  });
});

describe("prices, changes, shares, addresses", () => {
  it("formats a price far below one lamport", () => {
    expect(formatPrice(279_589n, true)).toBe("0.000000000279589 SOL"); // every digit, on request
    expect(formatPrice("1000000000000000")).toBe("1 SOL");
  });
  it("formats a change from whole basis points", () => {
    expect(formatChange(125)).toBe("+1.25%");
    expect(formatChange(-5)).toBe("-0.05%");
    expect(formatChange(0)).toBe("0.00%");
    expect(formatChange(1_234_500)).toBe("+12,345%"); // past a thousand percent the hundredths are noise
  });
  it("formats a share from whole parts per million", () => {
    expect(formatShare(151_700)).toBe("15.17%");
    expect(formatShare(0)).toBe("0.00%");
    expect(formatShare(1_000_000)).toBe("100.00%");
    expect(formatShare(99)).toBe("0.00%");
  });
  it("shortens an address without changing its case", () => {
    expect(shortAddress("B36s5UBkZN4DsHhS7c2nHKQPiuD8wmExuLkWLZK6GNTG")).toBe("B36s…GNTG");
    expect(shortAddress("short")).toBe("short");
  });
});
