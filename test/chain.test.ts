import { describe, expect, it } from "vitest";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { BondingCurve } from "@pump-fun/pump-sdk";
import { resolvePair, tokenAmountOf, type PairSource } from "../src/chain.js";

const TTWO = new PublicKey("TTWofwAge91oFhZs7kpQdyrVRkmevgM88xijGvQFbKo");
const coin = Keypair.generate().publicKey;

function source(quoteMint: PublicKey): PairSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetchBondingCurve(mint) {
      calls.push(`curve ${mint.toBase58()}`);
      return { quoteMint, creator: Keypair.generate().publicKey, complete: false, creatorFee: new BN(0) } as unknown as BondingCurve;
    },
    async fetchQuoteTokenProgram(mint) {
      calls.push(`program ${mint.toBase58()}`);
      return TOKEN_2022_PROGRAM_ID;
    },
  };
}

describe("reading what the coin is paired with", () => {
  it("uses the bonding curve, so it works before the treasury holds any of the coin", async () => {
    const s = source(TTWO);
    const pair = await resolvePair(s, coin, null);
    expect(pair.quoteMint.equals(TTWO)).toBe(true);
    expect(pair.quoteProgram.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    expect(s.calls).toEqual([`curve ${coin.toBase58()}`, `program ${TTWO.toBase58()}`]);
  });
  it("refuses a SOL-paired coin, whether the curve stores WSOL or the zero key", async () => {
    await expect(resolvePair(source(NATIVE_MINT), coin, null)).rejects.toThrow(/paired with SOL/);
    await expect(resolvePair(source(PublicKey.default), coin, null)).rejects.toThrow(/paired with SOL/);
  });
  it("refuses a pair other than EXPECTED_QUOTE_MINT", async () => {
    await expect(resolvePair(source(TTWO), coin, Keypair.generate().publicKey.toBase58())).rejects.toThrow(/not EXPECTED_QUOTE_MINT/);
    await expect(resolvePair(source(TTWO), coin, TTWO.toBase58())).resolves.toBeTruthy();
  });
});

describe("token account amounts", () => {
  it("reads the amount at byte 64 and treats a missing or short account as empty", () => {
    const data = Buffer.alloc(165);
    data.writeBigUInt64LE(123_456_789n, 64);
    expect(tokenAmountOf({ data })).toBe(123_456_789n);
    expect(tokenAmountOf(null)).toBe(0n);
    expect(tokenAmountOf({ data: Buffer.alloc(10) })).toBe(0n);
  });
});
