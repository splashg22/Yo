/** The two stand-in packages in vendor/: the number conversions are right at every width, and the other parses nothing. */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const load = createRequire(import.meta.url);
const numbers = load("bigint-buffer") as {
  toBigIntLE(buffer: Buffer): bigint;
  toBigIntBE(buffer: Buffer): bigint;
  toBufferLE(value: bigint, width: number): Buffer;
  toBufferBE(value: bigint, width: number): Buffer;
};

describe("the stand-in for bigint-buffer", () => {
  it("is the one the token library loads, and has no native code", () => {
    expect(load.resolve("bigint-buffer")).toMatch(/vendor\/bigint-buffer\/index\.js$/);
    const inside = createRequire(load.resolve("@solana/buffer-layout-utils"));
    expect(inside.resolve("bigint-buffer")).toBe(load.resolve("bigint-buffer"));
  });

  it("reads and writes whole numbers of every width, both byte orders, and round-trips them", () => {
    expect(numbers.toBigIntLE(Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]))).toBe(1n);
    expect(numbers.toBigIntLE(Buffer.from([0, 1]))).toBe(256n);
    expect(numbers.toBigIntBE(Buffer.from([0, 1]))).toBe(1n);
    expect(numbers.toBigIntLE(Buffer.alloc(0))).toBe(0n);
    expect(numbers.toBigIntBE(Buffer.alloc(0))).toBe(0n);
    expect(numbers.toBigIntLE(Buffer.alloc(8, 0xff))).toBe(2n ** 64n - 1n);
    expect([...numbers.toBufferLE(258n, 8)]).toEqual([2, 1, 0, 0, 0, 0, 0, 0]);
    expect([...numbers.toBufferBE(258n, 4)]).toEqual([0, 0, 1, 2]);
    for (const width of [1, 2, 4, 8, 16, 32]) {
      for (const value of [0n, 1n, 255n, 2n ** BigInt(width * 8) - 1n, (2n ** BigInt(width * 8) - 1n) / 3n]) {
        expect(numbers.toBigIntLE(numbers.toBufferLE(value, width))).toBe(value);
        expect(numbers.toBigIntBE(numbers.toBufferBE(value, width))).toBe(value);
        expect(numbers.toBufferLE(value, width)).toHaveLength(width);
      }
    }
  });

  it("never reads outside the buffer it is given", () => {
    // The published native code read eight bytes whatever it was handed. Here a short buffer is simply a small number.
    expect(numbers.toBigIntLE(Buffer.from([7]))).toBe(7n);
    expect(numbers.toBigIntLE(Buffer.from([7, 0, 0]))).toBe(7n);
    const inside = Buffer.from([9, 9, 1, 2, 9, 9]).subarray(2, 4);
    expect(numbers.toBigIntLE(inside)).toBe(513n);
    expect(numbers.toBigIntBE(inside)).toBe(258n);
  });
});

describe("the stand-in for toml", () => {
  it("parses nothing, and says so", () => {
    const toml = load("toml") as { parse(text: string): unknown };
    expect(() => toml.parse("a = 1")).toThrow(/not available in this project/);
  });
});
