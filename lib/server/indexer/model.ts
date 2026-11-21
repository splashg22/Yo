/** The indexer's own shapes, and the arithmetic shared by everything that reads them. */
import { COIN_DECIMALS } from "../../constants";
import type { Venue } from "./types";

export const TIMEFRAMES = [1, 60, 300, 900, 3600, 86400] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export const isTimeframe = (value: unknown): value is Timeframe => (TIMEFRAMES as readonly unknown[]).includes(value);

export interface Market {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  uri: string;
  /** Milliseconds. */
  createdAt: number;
  createdSlot: number;
  supply: bigint;
  /** What the curve had to sell when the coin was made. Progress towards graduation is measured against it. */
  initialRealTokens: bigint;
  virtualSol: bigint;
  virtualTokens: bigint;
  realSol: bigint;
  realTokens: bigint;
  complete: boolean;
  completedAt?: number;
  lastTradeAt?: number;
  pool?: string;
  holders: number;
  trades: number;
}
export interface Trade {
  signature: string;
  /** The trade's place among the trades of its transaction. */
  idx: number;
  mint: string;
  slot: number;
  txIndex: number;
  /** Milliseconds, from the block's own time. */
  at: number;
  wallet: string;
  isBuy: boolean;
  venue: Venue;
  sol: bigint;
  tokens: bigint;
  /** The price after this trade, in millionths of a lamport for one whole coin. */
  price: bigint;
}
/** One candle. Prices are millionths of a lamport for one whole coin; volume is lamports. Both fit a JavaScript number exactly. */
export interface Candle {
  /** Bucket start, seconds. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** Lamports traded. */
  v: number;
  /** Trades, and how many of them were buys. */
  n: number;
  b: number;
}

const MICRO = 1_000_000n;
const WHOLE_COIN = 10n ** BigInt(COIN_DECIMALS);
/** The price of one whole coin in millionths of a lamport, from the reserves. */
export const priceOf = (virtualSol: bigint, virtualTokens: bigint): bigint => (virtualTokens > 0n ? (virtualSol * WHOLE_COIN * MICRO) / virtualTokens : 0n);
export const marketCapOf = (market: Pick<Market, "supply" | "virtualSol" | "virtualTokens">): bigint =>
  market.virtualTokens > 0n ? (market.supply * market.virtualSol) / market.virtualTokens : 0n;
/** How far along the curve the coin is, in hundredths of a percent. A graduated coin is at 10,000. */
export function progressOf(market: Pick<Market, "complete" | "initialRealTokens" | "realTokens">): number {
  if (market.complete) return 10_000;
  if (market.initialRealTokens <= 0n) return 0;
  const sold = market.initialRealTokens - market.realTokens;
  return Math.max(0, Math.min(10_000, Number((sold * 10_000n) / market.initialRealTokens)));
}
export const bucketOf = (seconds: number, timeframe: number): number => seconds - (seconds % timeframe);

/** A candle after one more trade. `before` is the price just before the trade: a new bucket opens there, so candles join up. */
export function extend(candle: Candle | undefined, bucket: number, before: number, after: number, lamports: number, isBuy: boolean): Candle {
  if (!candle || candle.t !== bucket) {
    const open = before > 0 ? before : after;
    return { t: bucket, o: open, h: Math.max(open, after), l: Math.min(open, after), c: after, v: lamports, n: 1, b: isBuy ? 1 : 0 };
  }
  return {
    t: bucket,
    o: candle.o,
    h: Math.max(candle.h, after),
    l: Math.min(candle.l, after),
    c: after,
    v: candle.v + lamports,
    n: candle.n + 1,
    b: candle.b + (isBuy ? 1 : 0),
  };
}
