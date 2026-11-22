/**
 * A coin's picture, for coins not launched here: fetched from where the coin's creator points (lib/server/outside.ts),
 * decoded, drawn again small, and kept on this server's disk. The browser is only ever given this server's own copy:
 * a visitor's browser never calls the creator's host, so opening the board tells no stranger who is looking.
 *
 * Fetched only when a browser asks for it, a few at a time. A coin whose picture cannot be had is remembered as such
 * for an hour, so a broken link costs one try.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { settings } from "./env";
import { fetchOutside } from "./outside";

const SIDE = 96;
const DESCRIPTION_MAX_BYTES = 100_000;
const PICTURE_MAX_BYTES = 3_000_000;
const MAX_PIXELS = 16_000_000;
const AT_ONCE = 4;
const WAITING_MOST = 300;
const RETRY_AFTER_MS = 3_600_000;
/** After a "not now", how long before the same coin is tried again. */
const LATER_MS = 60_000;
const ALLOWED = new Set(["png", "jpeg", "webp", "gif", "avif"]);

const folder = (): string => {
  const path = join(settings().dataDir, "coin-images");
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
  return path;
};
let busy = 0;
const waiting: (() => void)[] = [];
const inFlight = new Map<string, Promise<Buffer | null | "later">>();
/** Set by tests: what fetches from outside. */
export const outside = { fetch: fetchOutside };

async function turn<T>(work: () => Promise<T>): Promise<T> {
  if (busy >= AT_ONCE) {
    if (waiting.length >= WAITING_MOST) throw new Error("too many pictures are being fetched");
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  busy += 1;
  try {
    return await work();
  } finally {
    busy -= 1;
    waiting.shift()?.();
  }
}

/** The picture a description file names, if it names one. */
export function pictureIn(description: Buffer): string | undefined {
  try {
    const found = JSON.parse(description.toString("utf8")) as { image?: unknown };
    return typeof found.image === "string" && found.image.length > 0 ? found.image : undefined;
  } catch {
    return undefined;
  }
}

/** A gateway said "not now" (too many requests, or its own fault): the picture may well exist, so it is asked for again soon. */
class Later extends Error {}
/** Public IPFS gateways, tried in turn. Any of them serves the same content for the same address, which is what makes the content checkable. */
const IPFS_GATEWAYS = ["https://ipfs.io/ipfs/", "https://dweb.link/ipfs/", "https://gateway.pinata.cloud/ipfs/"];
/** The addresses to try for one thing: for IPFS content, each public gateway; for anything else, itself. */
export function addressesFor(raw: string): string[] {
  const found = /^(?:ipfs:\/\/(?:ipfs\/)?|https:\/\/[^/]+\/ipfs\/)((?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})(?:\/[^?#]*)?)/i.exec(raw.trim());
  return found ? IPFS_GATEWAYS.map((gateway) => gateway + found[1]!) : [raw];
}
async function fetched(raw: string, maxBytes: number) {
  let busy = false;
  let last: unknown;
  for (const address of addressesFor(raw)) {
    try {
      return await outside.fetch(address, { maxBytes });
    } catch (error) {
      last = error;
      if (/answered (429|5\d\d)|timeout|aborted|fetch failed/i.test(String(error))) busy = true;
    }
  }
  throw busy ? new Later(String(last)) : last;
}

async function make(uri: string): Promise<Buffer | null> {
  const described = await fetched(uri, DESCRIPTION_MAX_BYTES);
  const picture = pictureIn(described.bytes);
  if (!picture) return null;
  const original = await fetched(picture, PICTURE_MAX_BYTES);
  const format = (await sharp(original.bytes, { limitInputPixels: MAX_PIXELS }).metadata()).format;
  if (!format || !ALLOWED.has(format)) return null;
  // Drawn again: a still square, with nothing of the original file left but its pixels.
  return sharp(original.bytes, { limitInputPixels: MAX_PIXELS }).rotate().resize(SIDE, SIDE, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
}

const askedLately = new Map<string, number>();
/**
 * A coin's picture as a small WebP; null if it has none that can be had; "later" if it could not be tried or the
 * host said not now. `uri` is what the coin points to on the chain.
 */
export function coinImage(mint: string, uri: string): Promise<Buffer | null | "later"> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return Promise.resolve(null);
  const kept = join(folder(), `${mint}.webp`);
  const none = join(folder(), `${mint}.none`);
  if (existsSync(kept)) return Promise.resolve(readFileSync(kept));
  if (existsSync(none) && Date.now() - statSync(none).mtimeMs < RETRY_AFTER_MS) return Promise.resolve(null);
  if (Date.now() - (askedLately.get(mint) ?? 0) < LATER_MS) return Promise.resolve("later");
  let running = inFlight.get(mint);
  if (!running) {
    // Too busy to try, or told "not now", is not "has no picture": only an attempt that got an answer is remembered on disk.
    running = turn(async (): Promise<Buffer | null | "later"> => {
      try {
        const bytes = await make(uri).catch((error: unknown) => {
          if (error instanceof Later) throw error;
          return null;
        });
        writeFileSync(bytes ? kept : none, bytes ?? "");
        return bytes;
      } catch {
        if (askedLately.size > 20_000) askedLately.clear();
        askedLately.set(mint, Date.now());
        return "later";
      }
    })
      .catch(() => "later" as const)
      .finally(() => inFlight.delete(mint));
    inFlight.set(mint, running);
  }
  return running;
}
