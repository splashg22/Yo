import { afterEach, describe, expect, it } from "vitest";
import { decodePrice, solPrice } from "../../lib/server/usd";

/** A price account as Pyth lays it out, for the given feed, price and time. */
function account(options: { feed?: string; price: bigint; exponent: number; published: number; partial?: boolean }): Buffer {
  const data = Buffer.alloc(134);
  let offset = 8 + 32;
  data[offset] = options.partial ? 0 : 1;
  offset += options.partial ? 2 : 1;
  Buffer.from(options.feed ?? "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex").copy(data, offset);
  offset += 32;
  data.writeBigInt64LE(options.price, offset);
  data.writeInt32LE(options.exponent, offset + 16);
  data.writeBigInt64LE(BigInt(options.published), offset + 20);
  return data;
}

describe("the price of SOL", () => {
  afterEach(() => delete process.env.LOCAL_SOL_USD);

  it("is read from Pyth's account: price, exponent and the time it was published", () => {
    expect(decodePrice(account({ price: 7_021_298_120n, exponent: -8, published: 1_795_300_000 }))).toEqual({ usd: 70.2129812, at: 1_795_300_000_000 });
    expect(decodePrice(account({ price: 15_012n, exponent: -2, published: 5, partial: true }))).toEqual({ usd: 150.12, at: 5000 });
  });

  it("is refused when the account is another feed, too short, or holds a price that cannot be right", () => {
    expect(decodePrice(account({ feed: "00".repeat(32), price: 1n, exponent: -8, published: 1 }))).toBeNull();
    expect(decodePrice(Buffer.alloc(20))).toBeNull();
    expect(decodePrice(account({ price: 0n, exponent: -8, published: 1 }))).toBeNull();
    expect(decodePrice(account({ price: -5n, exponent: -8, published: 1 }))).toBeNull();
    expect(decodePrice(account({ price: 5n, exponent: 3, published: 1 }))).toBeNull();
  });

  it("does not exist on a local chain unless one is fixed for testing, and then says so", async () => {
    expect(await solPrice()).toBeNull();
    process.env.LOCAL_SOL_USD = "150";
    expect(await solPrice(1000)).toEqual({ usd: 150, at: 1000, source: "fixed for local testing (LOCAL_SOL_USD)" });
    for (const wrong of ["0", "-3", "lots"]) {
      process.env.LOCAL_SOL_USD = wrong;
      expect(await solPrice()).toBeNull();
    }
  });
});
