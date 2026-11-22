/**
 * Whether a coin's pool liquidity can be pulled out: read from the chain, never assumed.
 *
 * A pump.fun pool gives out LP coins for the liquidity put in, and pump.fun burns the ones it gets when a coin
 * graduates. Whether that happened is two facts on the chain: how many LP coins the pool says it has issued, and how
 * many still exist. The difference was burned. LP coins that still exist can be handed back for the liquidity by
 * whoever holds them; this does not look at who that is, so "not burned" here means "could be withdrawn", not "will be".
 *
 * A Meteora DAMM v2 pool has no LP coin: liquidity sits in positions, and a position can be locked for good. The pool
 * account keeps the total locked for good beside its total liquidity. Locks that end on a date are not counted.
 */
import type * as SwapSdk from "@pump-fun/pump-sdk/swap";
import { unpackMint } from "@solana/spl-token";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { createRequire } from "node:module";
import type { LiquidityCheck } from "../contract";
import { poolAccount } from "./indexer/meteora";
import type { Market } from "./indexer/model";

const swap = createRequire(import.meta.url)("@pump-fun/pump-sdk/swap") as typeof SwapSdk;
type Info = AccountInfo<Buffer> | null;
type Read = (keys: PublicKey[]) => Promise<Info[]>;
/** A share in hundredths of a percent, rounded down, so 100% is said only when it is all of it. */
const shareBps = (part: bigint, whole: bigint): number => (whole > 0n ? Number((part * 10_000n) / whole) : 0);

/** From a pump.fun pool's account and its LP coin's account. */
export function burnedFrom(poolInfo: Info, lpInfo: (lpMint: PublicKey) => Info): LiquidityCheck {
  if (!poolInfo) return { kind: "unread", problem: "the chain holds no pool account at the coin's pool address" };
  let pool: ReturnType<typeof swap.PUMP_AMM_SDK.decodePool>;
  try {
    pool = swap.PUMP_AMM_SDK.decodePool(poolInfo);
  } catch {
    return { kind: "unread", problem: "the pool's account could not be read" };
  }
  const info = lpInfo(pool.lpMint);
  if (!info) return { kind: "unread", problem: "the pool's LP coin could not be read" };
  try {
    const issued = BigInt(pool.lpSupply.toString());
    const outstanding = unpackMint(pool.lpMint, info, info.owner).supply;
    const burned = issued > outstanding ? issued - outstanding : 0n;
    return { kind: "burned", issued: issued.toString(), outstanding: outstanding.toString(), burnedBps: shareBps(burned, issued) };
  } catch {
    return { kind: "unread", problem: "the pool's LP coin could not be read" };
  }
}
/** From a Meteora DAMM v2 pool's account. */
export function lockedFrom(poolInfo: Info): LiquidityCheck {
  const pool = poolInfo ? poolAccount(poolInfo.data) : undefined;
  if (!pool) return { kind: "unread", problem: "the pool's account could not be read" };
  return { kind: "locked", lockedBps: shareBps(pool.lockedForGood, pool.liquidity) };
}

/** The check for one coin: up to two reads of the chain. */
export async function liquidityOf(market: Pick<Market, "pool" | "venue" | "complete">, read: Read): Promise<LiquidityCheck> {
  if (!market.pool) return { kind: market.complete ? "none" : "curve" };
  try {
    const [poolInfo] = await read([new PublicKey(market.pool)]);
    if (market.venue === "damm2") return lockedFrom(poolInfo ?? null);
    let lp: Info = null;
    let wanted: PublicKey | undefined;
    try {
      wanted = poolInfo ? swap.PUMP_AMM_SDK.decodePool(poolInfo).lpMint : undefined;
    } catch {
      wanted = undefined;
    }
    if (wanted) [lp = null] = await read([wanted]);
    return burnedFrom(poolInfo ?? null, () => lp);
  } catch (error) {
    return { kind: "unread", problem: error instanceof Error ? error.message : String(error) };
  }
}
