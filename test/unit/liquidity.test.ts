/**
 * Whether a pool's liquidity can be pulled out, read from real accounts: a pump.fun pool and its LP coin, and three
 * Meteora pools, all copied from mainnet on 22 November 2026 (test/fixtures/liquidity-accounts.json).
 */
import { MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { burnedFrom, liquidityOf, lockedFrom } from "../../lib/server/liquidity";

interface Packed {
  owner: string;
  data: string;
}
const real = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "liquidity-accounts.json"), "utf8")) as {
  pump: { pool: string; poolAccount: Packed; lpMint: string; lpAccount: Packed };
  meteora: { pool: string; account: Packed; liquidity: string; lockedForGood: string }[];
};
const account = (packed: Packed): AccountInfo<Buffer> => ({
  owner: new PublicKey(packed.owner),
  data: Buffer.from(packed.data, "base64"),
  lamports: 1,
  executable: false,
});
/** The same LP coin with some of it still existing. */
function lpWith(supply: bigint): AccountInfo<Buffer> {
  const data = Buffer.alloc(MINT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply,
      decimals: 9,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  );
  return { owner: TOKEN_PROGRAM_ID, data, lamports: 1, executable: false };
}

describe("whether a pool's liquidity can be pulled out", () => {
  it("reads a real graduated pump.fun pool as burned: LP coins were issued and none exist", () => {
    const check = burnedFrom(account(real.pump.poolAccount), (lpMint) => (lpMint.toBase58() === real.pump.lpMint ? account(real.pump.lpAccount) : null));
    expect(check.kind).toBe("burned");
    if (check.kind !== "burned") return;
    expect(BigInt(check.issued)).toBeGreaterThan(0n);
    expect(check.outstanding).toBe("0");
    expect(check.burnedBps).toBe(10_000);
  });

  it("says a share when some LP coins still exist, and never rounds that up to all", () => {
    const pool = account(real.pump.poolAccount);
    const issued = BigInt((burnedFrom(pool, () => account(real.pump.lpAccount)) as { issued: string }).issued);
    const tenth = burnedFrom(pool, () => lpWith(issued / 10n));
    expect(tenth).toMatchObject({ kind: "burned", burnedBps: 9_000 });
    // One LP coin's smallest unit left: not 100%.
    expect((burnedFrom(pool, () => lpWith(1n)) as { burnedBps: number }).burnedBps).toBe(9_999);
    expect(burnedFrom(pool, () => lpWith(issued))).toMatchObject({ burnedBps: 0 });
    // More existing than the pool says it issued is not a negative burn.
    expect(burnedFrom(pool, () => lpWith(issued * 2n))).toMatchObject({ burnedBps: 0 });
  });

  it("does not pass a check it could not make", () => {
    expect(burnedFrom(null, () => null).kind).toBe("unread");
    expect(burnedFrom(account(real.pump.poolAccount), () => null).kind).toBe("unread");
    expect(burnedFrom({ ...account(real.pump.poolAccount), data: Buffer.alloc(12) }, () => account(real.pump.lpAccount)).kind).toBe("unread");
    expect(lockedFrom(null).kind).toBe("unread");
    expect(lockedFrom({ ...account(real.meteora[0]!.account), data: Buffer.alloc(40) }).kind).toBe("unread");
  });

  it("reads the share of a real Meteora pool's liquidity that is locked for good: part, all, and none", () => {
    const shares = real.meteora.map((pool) => {
      const check = lockedFrom(account(pool.account));
      expect(check.kind).toBe("locked");
      const want = Number((BigInt(pool.lockedForGood) * 10_000n) / BigInt(pool.liquidity));
      expect((check as { lockedBps: number }).lockedBps).toBe(want);
      return want;
    });
    expect(shares.some((share) => share > 0 && share < 10_000)).toBe(true);
    expect(shares).toContain(10_000);
    expect(shares).toContain(0);
  });

  it("asks the chain for the pool, then for its LP coin, and for nothing when there is no pool", async () => {
    const asked: string[][] = [];
    const read = (keys: PublicKey[]) => {
      asked.push(keys.map((key) => key.toBase58()));
      return Promise.resolve(
        keys.map((key) =>
          key.toBase58() === real.pump.pool ? account(real.pump.poolAccount) : key.toBase58() === real.pump.lpMint ? account(real.pump.lpAccount) : null,
        ),
      );
    };
    expect(await liquidityOf({ pool: real.pump.pool, complete: true }, read)).toMatchObject({ kind: "burned", burnedBps: 10_000 });
    expect(asked).toEqual([[real.pump.pool], [real.pump.lpMint]]);
    asked.length = 0;
    expect(await liquidityOf({ complete: false }, read)).toEqual({ kind: "curve" });
    expect(await liquidityOf({ complete: true }, read)).toEqual({ kind: "none" });
    expect(asked).toEqual([]);
    const meteora = real.meteora[0]!;
    expect((await liquidityOf({ pool: meteora.pool, venue: "damm2", complete: true }, () => Promise.resolve([account(meteora.account)]))).kind).toBe("locked");
    expect(await liquidityOf({ pool: real.pump.pool, complete: true }, () => Promise.reject(new Error("fetch failed")))).toEqual({
      kind: "unread",
      problem: "fetch failed",
    });
  });
});
