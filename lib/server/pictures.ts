/**
 * A coin's picture and the small file that describes the coin, which pump.fun's coins point to.
 *
 * Whatever is uploaded is decoded and drawn again as a 512px WebP before anything is kept.
 * That drops hidden data (location, camera, comments), refuses anything that is not really
 * an image, and means a file made to attack an image viewer is never served as it arrived.
 *
 * Where it is kept is one setting. Without PINATA_JWT: a folder on this server, served by
 * this site (a stand-in, lost if the server's disk is). With it: pinned to IPFS through
 * Pinata. The Pinata path has NOT been run against the real service.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { settings } from "./env";

export const PICTURE_MAX_BYTES = 1_500_000;
const ALLOWED = new Set(["png", "jpeg", "webp", "gif"]);
const SIDE = 512;
/** Names this site will serve from its uploads folder: nothing else, so a path can never be smuggled in. */
export const STORED_NAME = /^[a-f0-9]{24}\.(webp|json)$/;

/** Decodes an upload and returns it redrawn as a square WebP. Refuses anything that is not a still or animated raster image. */
/** Pictures are decoded one at a time, so a burst of uploads cannot multiply the memory decoding takes. */
let decoding: Promise<unknown> = Promise.resolve();
const MAX_PIXELS = 16_000_000;

export function cleanPicture(base64: string): Promise<Buffer> {
  const next = decoding.then(() => cleanOne(base64));
  decoding = next.catch(() => undefined);
  return next;
}

async function cleanOne(base64: string): Promise<Buffer> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error("the picture did not arrive intact");
  const original = Buffer.from(base64, "base64");
  if (original.length === 0) throw new Error("the picture is empty");
  if (original.length > PICTURE_MAX_BYTES) throw new Error("the picture is larger than 1.5 MB");
  let format: string | undefined;
  try {
    // A pixel limit, so a small file that unpacks to an enormous image cannot exhaust the server's memory.
    format = (await sharp(original, { limitInputPixels: MAX_PIXELS }).metadata()).format;
  } catch {
    format = undefined;
  }
  if (!format || !ALLOWED.has(format)) throw new Error("the picture must be a PNG, JPEG, WebP or GIF image");
  try {
    return await sharp(original, { limitInputPixels: MAX_PIXELS }).rotate().resize(SIDE, SIDE, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
  } catch {
    throw new Error("the picture could not be read");
  }
}

const uploads = (): string => join(settings().dataDir, "uploads");
const nameOf = (bytes: Buffer, extension: "webp" | "json"): string => `${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}.${extension}`;

async function pin(bytes: Buffer, name: string, type: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
  const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { authorization: `Bearer ${settings().pinataJwt}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const answer = (await response.json().catch(() => null)) as { IpfsHash?: string } | null;
  if (!response.ok || !answer?.IpfsHash) throw new Error("the picture store did not accept the upload. Try again, or launch without a picture.");
  return `https://gateway.pinata.cloud/ipfs/${answer.IpfsHash}`;
}

/**
 * Keeps a file and says where it is: `absolute` for anyone on the internet (what goes on-chain and
 * into the description file), `forThisSite` for this site's own pages. For a file kept on this server
 * the second is a path, so the pages work whatever address or port the site is reached at.
 */
async function keep(bytes: Buffer, extension: "webp" | "json"): Promise<{ absolute: string; forThisSite: string }> {
  const name = nameOf(bytes, extension);
  if (settings().pinataJwt) {
    const pinned = await pin(bytes, name, extension === "webp" ? "image/webp" : "application/json");
    return { absolute: pinned, forThisSite: pinned };
  }
  mkdirSync(uploads(), { recursive: true });
  writeFileSync(join(uploads(), name), bytes);
  return { absolute: `${settings().siteUrl}/u/${name}`, forThisSite: `/u/${name}` };
}

/** Stores a coin's picture and its description file. Returns where each can be fetched; `uri` is what goes on-chain. */
export async function storeCoinDetails(coin: { name: string; symbol: string; description: string; picture?: string }): Promise<{ uri: string; image: string }> {
  const image = coin.picture ? await keep(await cleanPicture(coin.picture), "webp") : undefined;
  const details = { name: coin.name, symbol: coin.symbol, description: coin.description, ...(image ? { image: image.absolute } : {}) };
  return { uri: (await keep(Buffer.from(JSON.stringify(details)), "json")).absolute, image: image?.forThisSite ?? "" };
}

/** A stored file by name, for this site to serve. Null for any name that is not one of ours, or is not there. */
export function storedFile(name: string): { bytes: Buffer; type: string } | null {
  if (!STORED_NAME.test(name)) return null;
  const path = join(uploads(), name);
  if (!existsSync(path)) return null;
  return { bytes: readFileSync(path), type: name.endsWith(".webp") ? "image/webp" : "application/json" };
}
