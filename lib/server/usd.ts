/**
 * The price of SOL in US dollars, for showing a dollar figure beside every SOL one.
 *
 * It is read from Pyth's SOL/USD price account on the chain, through this server's own RPC: no other
 * service is asked. A price older than the limit is not used: the site shows SOL alone rather than a
 * dollar figure it cannot stand behind. On a local validator there is no such account, so there is no
 * dollar figure unless LOCAL_SOL_USD sets one for testing, and then the status page says it is fixed.
 */
import { PublicKey } from "@solana/web3.js";
import { settings } from "./env";
import { connection } from "./solana";

/** Pyth's sponsored SOL/USD feed account: the same address on devnet and mainnet. */
const FEED_ACCOUNT = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
const FEED_ID = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const READ_EVERY_MS = 20_000;
/** Devnet's copy of the feed is updated less often than mainnet's; older than this it is not shown at all. */
export const STALE_AFTER_MS = 20 * 60_000;

export interface SolPrice {
  /** US dollars for one SOL. */
  usd: number;
  /** When the price was published, milliseconds. */
  at: number;
  source: string;
}

/** Reads Pyth's price account. Layout: 8 bytes of tag, 32 of authority, the verification level (1 or 2 bytes), 32 of feed id, then price, confidence, exponent, publish time. */
export function decodePrice(data: Buffer): { usd: number; at: number } | null {
  if (data.length < 8 + 32 + 1 + 32 + 28) return null;
  let offset = 8 + 32;
  const level = data[offset]!;
  offset += level === 0 ? 2 : 1;
  if (data.subarray(offset, offset + 32).toString("hex") !== FEED_ID) return null;
  offset += 32;
  const price = data.readBigInt64LE(offset);
  const exponent = data.readInt32LE(offset + 16);
  const published = data.readBigInt64LE(offset + 20);
  if (price <= 0n || exponent > 0 || exponent < -18) return null;
  return { usd: Number(price) * 10 ** exponent, at: Number(published) * 1000 };
}

let kept: { url: string; readAt: number; value: Promise<SolPrice | null> } | undefined;
let latest: SolPrice | null = null;
/**
 * The price as last read, without waiting for anything: what a page is rendered with, so its dollar figures are in
 * the first paint and nothing moves when they would otherwise arrive. Null until the first read has come back.
 */
export function knownSolPrice(now = Date.now()): SolPrice | null {
  // Asking keeps the price fresh for the next page; the answer is not waited for.
  void solPrice(now).then((price) => (latest = price));
  if (settings().network === "local") {
    const fixed = Number(process.env.LOCAL_SOL_USD ?? "");
    return Number.isFinite(fixed) && fixed > 0 ? { usd: fixed, at: now, source: "fixed for local testing (LOCAL_SOL_USD)" } : null;
  }
  return latest && now - latest.at <= STALE_AFTER_MS ? latest : null;
}
/** The current price, or null if there is none worth showing. Asks the chain at most every twenty seconds. */
export function solPrice(now = Date.now()): Promise<SolPrice | null> {
  const { network } = settings();
  if (network === "local") {
    const fixed = Number(process.env.LOCAL_SOL_USD ?? "");
    return Promise.resolve(Number.isFinite(fixed) && fixed > 0 ? { usd: fixed, at: now, source: "fixed for local testing (LOCAL_SOL_USD)" } : null);
  }
  const url = connection().rpcEndpoint;
  if (!kept || kept.url !== url || now - kept.readAt > READ_EVERY_MS) {
    const value = connection()
      .getAccountInfo(FEED_ACCOUNT)
      .then((info) => {
        const read = info ? decodePrice(info.data) : null;
        return read ? { ...read, source: "Pyth SOL/USD, read from the chain" } : null;
      })
      .catch(() => null);
    kept = { url, readAt: now, value };
  }
  return kept.value.then((price) => (price && now - price.at <= STALE_AFTER_MS ? price : null));
}
