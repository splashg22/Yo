/**
 * A ceiling on how fast one address may call the server, so that one caller cannot starve
 * the rest or drain the local faucet. Counts are kept in memory per minute: enough for one
 * server process, which is all this build runs as.
 */
export type Bucket = "faucet" | "launch" | "write" | "read";

/** Requests allowed per address per minute. Reads are cheap and pages poll, so their ceiling is high. */
/** Launches are held lower still: each may carry a picture that the server has to decode and redraw. */
export const PER_MINUTE: Record<Bucket, number> = { faucet: 30, launch: 30, write: 240, read: 1200 };
const WINDOW_MS = 60_000;

const counts = new Map<string, { windowStart: number; used: number }>();

export function bucketOf(operation: string): Bucket {
  if (operation === "faucet") return "faucet";
  if (operation === "launch/build" || operation === "window/launch/build") return "launch";
  // Anything that builds, sends or moves something, and every request signed by a wallet.
  return /build|send|credit|reconcile|^ring\/|^otc\/|^window\/(?!list)/.test(operation) ? "write" : "read";
}

/** Counts one request. Returns how many seconds to wait if the caller is over the ceiling, or 0 if it may go ahead. */
export function overLimit(caller: string, bucket: Bucket, now = Date.now()): number {
  const key = `${bucket}:${caller}`;
  const current = counts.get(key);
  if (!current || now - current.windowStart >= WINDOW_MS) {
    // A new minute for this caller. Old entries of callers who went away are dropped as the map grows.
    if (counts.size > 10_000) for (const [other, entry] of counts) if (now - entry.windowStart >= WINDOW_MS) counts.delete(other);
    counts.set(key, { windowStart: now, used: 1 });
    return 0;
  }
  current.used += 1;
  return current.used > PER_MINUTE[bucket] ? Math.ceil((current.windowStart + WINDOW_MS - now) / 1000) : 0;
}

/**
 * Who is calling, for counting. The forwarding header is written by whoever sends the request, so it is believed
 * only as far as the operator says there are proxies of their own in front: TRUSTED_PROXY_HOPS entries, counted
 * from the right, were added by those proxies. With none (the default) the header is ignored and every caller
 * counts as one, which is right for a server reached directly.
 */
export function callerOf(forwardedFor: string | null): string {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? "0");
  if (!Number.isInteger(hops) || hops < 1 || !forwardedFor) return "direct";
  const chain = forwardedFor.split(",").map((part) => part.trim());
  return chain[chain.length - hops] ?? "direct";
}

/** Tests only. */
export const forgetLimits = (): void => counts.clear();
