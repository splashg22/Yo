/**
 * Meteora's DAMM v2 pools (program cpamd...): the pool program that carries the most trading outside pump.fun's own.
 * Read here by hand from the layouts Meteora publishes in its SDK (@meteora-ag/cp-amm-sdk 1.5.1, MIT), and checked
 * against real transactions (test/unit/meteora.test.ts). Only what the terminal shows is read: swaps, new pools, and
 * how much of a pool's liquidity is locked for good.
 *
 * A swap event names its pool and not the coins in it, and prices are a square root in 64.64 fixed point between two
 * amounts in the coins' own smallest units. `tradeFrom` turns one into the indexer's ordinary trade once the pool's
 * two coins are known (lib/server/pools.ts reads them from the chain, once per pool).
 */
import bs58 from "bs58";
import type { TradeEvent } from "./types";

export const DAMM2_PROGRAM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
/** The one address that owns every DAMM v2 pool's coins. It holds coins without being a holder, as a curve does. */
export const DAMM2_AUTHORITY = "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC";
const WSOL = "So11111111111111111111111111111111111111112";
const tag = (bytes: number[]): string => Buffer.from(bytes).toString("hex");
const SWAP = tag([189, 66, 51, 168, 38, 80, 117, 153]);
const NEW_POOL = tag([228, 50, 246, 85, 203, 66, 134, 37]);
const address = (data: Buffer, at: number): string => bs58.encode(data.subarray(at, at + 32));
const u128 = (data: Buffer, at: number): bigint => data.readBigUInt64LE(at) | (data.readBigUInt64LE(at + 8) << 64n);

/** A swap as the program reports it: amounts in each coin's smallest unit, with nothing yet said about which coin is which. */
export interface Damm2Swap {
  kind: "damm2-swap";
  pool: string;
  /** True when coin A went in and coin B came out. */
  aToB: boolean;
  /** What the trader put in, fees included, and what came out. */
  amountIn: bigint;
  amountOut: bigint;
  /** The square root of the price of A in B after the swap, in 64.64 fixed point. */
  sqrtPrice: bigint;
  reserveA: bigint;
  reserveB: bigint;
  /** Filled in from the transaction: the wallet that paid for it. The event itself names no trader. */
  wallet: string;
}
export interface Damm2Pool {
  kind: "damm2-pool";
  pool: string;
  mintA: string;
  mintB: string;
  creator: string;
}

/** One DAMM v2 event from its bytes (discriminator first), or null if it is not one read here. */
export function decodeDamm2(data: Buffer): Damm2Swap | Damm2Pool | null {
  if (data.length < 8) return null;
  const kind = data.subarray(0, 8).toString("hex");
  const body = data.subarray(8);
  if (kind === SWAP) {
    // pool 32 | direction 1 | fee mode 1 | referral 1 | parameters 8+8+1 | result: in 8, in less fee 8, left 8, out 8, price 16, four fees 8 each
    // | three transfer-fee amounts 8 each | time 8 | reserve A 8 | reserve B 8
    if (body.length < 180) return null;
    return {
      kind: "damm2-swap",
      pool: address(body, 0),
      aToB: body[32] === 0,
      amountIn: body.readBigUInt64LE(52),
      amountOut: body.readBigUInt64LE(76),
      sqrtPrice: u128(body, 84),
      reserveA: body.readBigUInt64LE(164),
      reserveB: body.readBigUInt64LE(172),
      wallet: "",
    };
  }
  if (kind === NEW_POOL) {
    if (body.length < 160) return null;
    return { kind: "damm2-pool", pool: address(body, 0), mintA: address(body, 32), mintB: address(body, 64), creator: address(body, 96) };
  }
  return null;
}

/** What is known of a pool once its account and its two coins have been read. */
export interface PoolFacts {
  pool: string;
  /** The coin traded: the side that is not SOL. */
  mint: string;
  coinIsA: boolean;
  decimals: number;
  /** The coin's whole supply, in its own smallest units. */
  supply: bigint;
  /** What the other side is. Only pools against SOL are read as trades. */
  quote: string;
}
export const pricedInSol = (facts: PoolFacts): boolean => facts.quote === WSOL;

/**
 * Everything the terminal holds about a coin assumes six decimals, as every pump.fun coin has. A coin with more or
 * fewer is brought to that scale here, once, so nothing downstream has to know: an amount in its own smallest units
 * becomes the same amount in millionths of a coin. For a coin with nine decimals that drops what is smaller than a
 * millionth of a coin, which no figure on the page shows.
 */
export function toMillionths(amount: bigint, decimals: number): bigint {
  if (decimals === 6) return amount;
  return decimals > 6 ? amount / 10n ** BigInt(decimals - 6) : amount * 10n ** BigInt(6 - decimals);
}
/** The scale the indexer's "virtual" reserves are written at for a pool whose price is not a ratio of what it holds. */
const SCALE = 1_000_000_000_000_000n;

/** The indexer's trade for a swap in a pool against SOL. Undefined for a pool against anything else. */
export function tradeFrom(swap: Damm2Swap, facts: PoolFacts): TradeEvent | undefined {
  if (!pricedInSol(facts) || swap.sqrtPrice === 0n) return undefined;
  // A buy is SOL going in. SOL is B when the coin is A, so a buy is then B to A.
  const isBuy = facts.coinIsA ? !swap.aToB : swap.aToB;
  const sol = isBuy ? swap.amountIn : swap.amountOut;
  const tokens = toMillionths(isBuy ? swap.amountOut : swap.amountIn, facts.decimals);
  // Lamports for one smallest unit of the coin is price² (coin is A) or its inverse (coin is B). Written as the lamports
  // that SCALE millionths of a coin are worth, so that the same arithmetic as a curve's reserves gives the price.
  const squared = swap.sqrtPrice * swap.sqrtPrice;
  const perUnit = facts.coinIsA ? { top: squared, bottom: 1n << 128n } : { top: 1n << 128n, bottom: squared };
  const shift = BigInt(Math.abs(facts.decimals - 6));
  const virtualSol = facts.decimals >= 6 ? (perUnit.top * SCALE * 10n ** shift) / perUnit.bottom : (perUnit.top * SCALE) / (perUnit.bottom * 10n ** shift);
  return {
    kind: "trade",
    venue: "damm2",
    mint: `damm2:${swap.pool}`,
    wallet: swap.wallet,
    isBuy,
    sol,
    tokens,
    virtualSol,
    virtualTokens: SCALE,
    realSol: facts.coinIsA ? swap.reserveB : swap.reserveA,
    realTokens: toMillionths(facts.coinIsA ? swap.reserveA : swap.reserveB, facts.decimals),
  };
}

/**
 * A pool's account, as far as it is read here: its two coins, its liquidity, and how much of that is locked for good.
 * The offsets are those of the program's `Pool` layout; `at` is where the first coin's address sits, found once from a
 * live account and fixed below.
 */
export const POOL_MINT_A_AT = 168;
export function poolAccount(data: Buffer): { mintA: string; mintB: string; liquidity: bigint; lockedForGood: bigint } | undefined {
  const at = POOL_MINT_A_AT;
  if (data.length < at + 400) return undefined;
  return { mintA: address(data, at), mintB: address(data, at + 32), liquidity: u128(data, at + 192), lockedForGood: u128(data, at + 384) };
}
