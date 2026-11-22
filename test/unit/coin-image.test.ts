/** A coin's picture: fetched once, drawn again, kept; a broken one remembered; a busy host asked again later. */
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { coinImage, forgetPictureState, outside, pictureKept, pictureStats } from "../../lib/server/coin-image";

const previous = process.env.APP_DATA_DIR;
const real = outside.fetch;
let dir = "";
let calls: string[] = [];
const mint = (n: number): string => `${"1".repeat(31)}${"ABCDEFGH"[n]}`;
const png = (): Promise<Buffer> =>
  sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .png()
    .toBuffer();

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ring-images-"));
  process.env.APP_DATA_DIR = dir;
});
afterAll(() => {
  outside.fetch = real;
  if (previous === undefined) delete process.env.APP_DATA_DIR;
  else process.env.APP_DATA_DIR = previous;
});
beforeEach(() => {
  calls = [];
  forgetPictureState();
});

describe("a coin's picture", () => {
  it("is fetched from where the coin points, drawn again as a small square, and kept so it is fetched once", async () => {
    const picture = await png();
    outside.fetch = (address) => {
      calls.push(address);
      return Promise.resolve(
        address.endsWith(".json")
          ? { bytes: Buffer.from(JSON.stringify({ image: "https://pictures.example-host.com/p.png" })), type: "application/json" }
          : { bytes: picture, type: "image/png" },
      );
    };
    const made = await coinImage(mint(0), "https://example-host.com/coin.json");
    expect(Buffer.isBuffer(made)).toBe(true);
    const read = await sharp(made as Buffer).metadata();
    expect([read.format, read.width, read.height]).toEqual(["webp", 144, 144]);
    expect(calls).toEqual(["https://example-host.com/coin.json", "https://pictures.example-host.com/p.png"]);
    // The smaller sizes, for screens with one or two device pixels to the pixel, are made from the kept copy: nothing more is fetched.
    for (const width of [48, 96] as const) {
      const smaller = await sharp((await coinImage(mint(0), "https://example-host.com/coin.json", width)) as Buffer).metadata();
      expect([smaller.format, smaller.width, smaller.height]).toEqual(["webp", width, width]);
    }
    expect(calls).toHaveLength(2);
    // Asked again: from disk, with nothing fetched.
    expect(Buffer.isBuffer(await coinImage(mint(0), "https://example-host.com/coin.json"))).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("is refused when what comes back is not a picture, and that is remembered", async () => {
    outside.fetch = (address) => {
      calls.push(address);
      return Promise.resolve(
        address.endsWith(".json")
          ? { bytes: Buffer.from(JSON.stringify({ image: "https://pictures.example-host.com/evil.png" })), type: "application/json" }
          : { bytes: Buffer.from("<svg onload=alert(1)>"), type: "image/png" },
      );
    };
    expect(await coinImage(mint(1), "https://example-host.com/coin.json")).toBeNull();
    expect(await coinImage(mint(1), "https://example-host.com/coin.json")).toBeNull();
    expect(calls).toHaveLength(2);
    expect(existsSync(join(dir, "coin-images", `${mint(1)}.none`))).toBe(true);
  });

  it("is not written off when the host says not now: nothing is remembered on disk, and it is asked again later", async () => {
    outside.fetch = (address) => {
      calls.push(address);
      return Promise.reject(new Error("the address answered 429"));
    };
    const cid = "QmQ77MDu7SSB599eVZr2MhYA3bUYuVmbNvZgS7R2x58SJr";
    expect(await coinImage(mint(2), `https://ipfs.io/ipfs/${cid}`)).toBe("later");
    // Every gateway was tried before giving up for now.
    expect(calls).toHaveLength(3);
    expect(readdirSync(join(dir, "coin-images")).filter((name) => name.startsWith(mint(2)))).toEqual([]);
    // Straight away again: not tried, still "later".
    expect(await coinImage(mint(2), `https://ipfs.io/ipfs/${cid}`)).toBe("later");
    expect(calls).toHaveLength(3);
  });

  it("falls back to the next gateway when the first one fails", async () => {
    const picture = await png();
    const cid = "QmQ77MDu7SSB599eVZr2MhYA3bUYuVmbNvZgS7R2x58SJr";
    outside.fetch = (address) => {
      calls.push(address);
      if (address.startsWith("https://ipfs.io/")) return Promise.reject(new Error("the address answered 429"));
      return Promise.resolve(
        address.includes(cid)
          ? { bytes: Buffer.from(JSON.stringify({ image: "https://pictures.example-host.com/p.png" })), type: "" }
          : { bytes: picture, type: "image/png" },
      );
    };
    expect(Buffer.isBuffer(await coinImage(mint(3), `ipfs://${cid}`))).toBe(true);
    expect(calls.slice(0, 2)).toEqual([`https://ipfs.io/ipfs/${cid}`, `https://dweb.link/ipfs/${cid}`]);
  });

  it("refuses anything that is not a coin's address without touching the disk or the network", async () => {
    expect(await coinImage("../../etc/passwd", "https://example-host.com/coin.json")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("leaves a gateway alone for a while after it says not now, and still finds the picture at the next one", async () => {
    const picture = await png();
    const cid = "QmQ77MDu7SSB599eVZr2MhYA3bUYuVmbNvZgS7R2x58SJr";
    outside.fetch = (address) => {
      calls.push(address);
      if (address.startsWith("https://ipfs.io/")) return Promise.reject(new Error("the address answered 429"));
      return Promise.resolve(
        address.endsWith("/p.png") ? { bytes: picture, type: "image/png" } : { bytes: Buffer.from(JSON.stringify({ image: `ipfs://${cid}/p.png` })), type: "" },
      );
    };
    expect(Buffer.isBuffer(await coinImage(mint(4), `ipfs://${cid}`))).toBe(true);
    // The first gateway was asked once. The picture itself, on the same gateways, was asked of the second straight away.
    expect(calls.filter((address) => address.startsWith("https://ipfs.io/"))).toHaveLength(1);
    expect(calls[calls.length - 1]!.startsWith("https://dweb.link/")).toBe(true);
    // And the next coin does not try the resting gateway at all.
    calls = [];
    await coinImage(mint(5), `ipfs://${cid}`);
    expect(calls.some((address) => address.startsWith("https://ipfs.io/"))).toBe(false);
  });

  it("knows what it already keeps, so nothing kept is fetched ahead again", () => {
    expect(pictureKept(mint(0))).toBe(true);
    // A coin found to have no picture counts as kept for the hour it is remembered.
    expect(pictureKept(mint(1))).toBe(true);
    expect(pictureKept(mint(7))).toBe(false);
    expect(pictureStats.kept).toBeGreaterThan(0);
    expect(pictureStats.none).toBeGreaterThan(0);
  });
});
