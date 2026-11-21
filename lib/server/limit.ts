/**
 * A ceiling on how fast one address may call the server, so that one caller cannot starve
 * the rest or drain the local faucet. Counts are kept in memory per minute: enough for one
 * server process, which is all this build runs as.
 */
export type Bucket = "faucet" | "write" | "read";

/** Requests allowed per address per minute. Reads are cheap and pages poll, so their ceiling is high. */
export const PER_MINUTE: Record<Bucket, number> = { faucet: 30, write: 240, read: 1200 };
const WINDOW_MS = 60_000;

const counts = new Map<string, { windowStart: number; used: number }>();

export function bucketOf(operation: string): Bucket {
  if (operation === "faucet") return "faucet";
  // Anything that builds, sends or moves something, and every request signed by a wallet.
  return /build|send|credit|reconcile|^ring\/|^otc\//.test(operation) ? "write" : "read";
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

/** Tests only. */
export const forgetLimits = (): void => counts.clear();
