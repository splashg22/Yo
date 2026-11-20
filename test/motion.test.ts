import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript shared with the browser pages
import { easeOut, frameText, parseAmount } from "../web/motion.js";

describe("metric count-up", () => {
  it("eases out: fast at first, settling exactly on 1", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.8);
    expect(easeOut(2)).toBe(1);
    expect(easeOut(-1)).toBe(0);
  });
  it("parses a formatted amount and keeps whatever surrounds it", () => {
    expect(parseAmount("945,629,062")).toMatchObject({ value: 945629062, decimals: 0, grouped: true, prefix: "", suffix: "" });
    expect(parseAmount("1,234.5678")).toMatchObject({ value: 1234.5678, decimals: 4 });
    expect(parseAmount("40%")).toMatchObject({ value: 40, suffix: "%" });
    expect(parseAmount("−0.5 TTWO")).toMatchObject({ value: 0.5, suffix: " TTWO" });
    expect(parseAmount("—")).toBeNull();
  });
  it("renders intermediate frames in the same format and lands on the exact text", () => {
    const p = parseAmount("1,500.25")!;
    expect(frameText(p, 0)).toBe("0.00");
    expect(frameText(p, 1)).toBe("1,500.25");
    const mid = frameText(p, 0.5);
    expect(mid).toMatch(/^1,\d{3}\.\d{2}$/);
    expect(Number(mid.replace(",", ""))).toBeLessThan(1500.25);
    expect(frameText(parseAmount("40%")!, 1)).toBe("40%");
  });
});
