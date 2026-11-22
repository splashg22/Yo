/**
 * A coin's picture, for coins not launched here: fetched from where the coin's creator points (lib/server/outside.ts),
 * decoded, drawn again small, and kept on this server's disk. The browser is only ever given this server's own copy:
 * a visitor's browser never calls the creator's host, so opening the board tells no stranger who is looking.
 *
 * Fetched ahead of being asked for: the server fetches the pictures of the coins its board and rankings show
 * (lib/server/market.ts), a few at a time, so a row is drawn from this cache and does not wait on anyone's gateway.
 * A coin whose picture cannot be had is remembered as such for an hour, so a broken link costs one try. A gateway
 * that says "not now" is left alone for half a minute.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { settings } from "./env";
import { fetchOutside } from "./outside";

/** The copy kept: three times the largest size a coin picture is shown at, so it is sharp on the densest screens. */
const SIDE = 144;
/** The sizes served: what a 48px picture needs at one, two and three device pixels to the pixel. Nothing is ever enlarged. */
export const PICTURE_WIDTHS = [48, 96, 144] as const;
export type PictureWidth = (typeof PICTURE_WIDTHS)[number];
export const pictureWidthOf = (value: string | null | undefined): PictureWidth => (value === "48" ? 48 : value === "96" ? 96 : 144);
const DESCRIPTION_MAX_BYTES = 100_000;
const PICTURE_MAX_BYTES = 3_000_000;
const MAX_PIXELS = 16_000_000;
const AT_ONCE = 8;
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
/** A host that said "not now" is left alone for this long: asking it again at once only earns another refusal. */
const COOL_MS = 30_000;
const cooling = new Map<string, number>();
const hostOf = (address: string): string => {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
};
/** What the cache has done since the server started, for /health. */
export const pictureStats = { kept: 0, none: 0, later: 0, fromDisk: 0 };

async function fetched(raw: string, maxBytes: number) {
  let busy = false;
  let last: unknown = new Error("every gateway is being left alone for a moment");
  const now = Date.now();
  const candidates = addressesFor(raw);
  const rested = candidates.filter((address) => (cooling.get(hostOf(address)) ?? 0) <= now);
  if (rested.length === 0) throw new Later(String(last));
  for (const address of rested) {
    try {
      return await outside.fetch(address, { maxBytes });
    } catch (error) {
      last = error;
      if (/answered (429|5\d\d)|timeout|aborted|fetch failed/i.test(String(error))) {
        busy = true;
        cooling.set(hostOf(address), Date.now() + COOL_MS);
      }
    }
  }
  // Some gateways were not tried because they are resting: the picture may still be there.
  throw busy || rested.length < candidates.length ? new Later(String(last)) : last;
}
/** For tests: forget which hosts are resting and which coins were asked for lately. */
export function forgetPictureState(): void {
  cooling.clear();
  askedLately.clear();
}
/** True while there is room to start another fetch without queueing behind the ones under way. */
export const pictureRoom = (): boolean => busy < AT_ONCE && waiting.length === 0;
/** True when a coin's picture, or the fact that it has none, is already kept. */
export function pictureKept(mint: string): boolean {
  const none = join(folder(), `${mint}.none`);
  return existsSync(join(folder(), `${mint}.webp`)) || (existsSync(none) && Date.now() - statSync(none).mtimeMs < RETRY_AFTER_MS);
}

async function make(uri: string): Promise<Buffer | null> {
  const described = await fetched(uri, DESCRIPTION_MAX_BYTES);
  const picture = pictureIn(described.bytes);
  if (!picture) return null;
  const original = await fetched(picture, PICTURE_MAX_BYTES);
  const format = (await sharp(original.bytes, { limitInputPixels: MAX_PIXELS }).metadata()).format;
  if (!format || !ALLOWED.has(format)) return null;
  // Drawn again: a still square, with nothing of the original file left but its pixels.
  return sharp(original.bytes, { limitInputPixels: MAX_PIXELS }).rotate().resize(SIDE, SIDE, { fit: "cover" }).webp({ quality: 88 }).toBuffer();
}

const askedLately = new Map<string, number>();
/**
 * A coin's picture as a small WebP; null if it has none that can be had; "later" if it could not be tried or the
 * host said not now. `uri` is what the coin points to on the chain.
 */
export async function coinImage(mint: string, uri: string, width: PictureWidth = SIDE): Promise<Buffer | null | "later"> {
  const full = await fullPicture(mint, uri);
  if (!Buffer.isBuffer(full) || width === SIDE) return full;
  // A smaller copy is made from the kept one the first time it is asked for, and kept beside it.
  const smaller = join(folder(), `${mint}-${width}.webp`);
  if (existsSync(smaller)) return readFileSync(smaller);
  const made = await sharp(full).resize(width, width, { fit: "cover", kernel: "lanczos3" }).webp({ quality: 86 }).toBuffer();
  writeFileSync(smaller, made);
  return made;
}
function fullPicture(mint: string, uri: string): Promise<Buffer | null | "later"> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return Promise.resolve(null);
  const kept = join(folder(), `${mint}.webp`);
  const none = join(folder(), `${mint}.none`);
  if (existsSync(kept)) {
    pictureStats.fromDisk += 1;
    return Promise.resolve(readFileSync(kept));
  }
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
        if (bytes) pictureStats.kept += 1;
        else pictureStats.none += 1;
        return bytes;
      } catch {
        pictureStats.later += 1;
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
