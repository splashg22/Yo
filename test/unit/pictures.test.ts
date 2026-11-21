import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { PICTURE_MAX_BYTES, cleanPicture, storeCoinDetails, storedFile } from "../../lib/server/pictures";

async function picture(format: "png" | "jpeg" | "webp" | "gif", width = 300, height = 200): Promise<string> {
  const blank = sharp({ create: { width, height, channels: 3, background: { r: 245, g: 165, b: 36 } } });
  return (await blank[format]().toBuffer()).toString("base64");
}
/** What the server answers for /u/<name>. Its headers are checked against the real server in test/flows/server.test.ts. */
const serve = (name: string): Response => {
  const file = storedFile(name);
  return file ? new Response(new Uint8Array(file.bytes), { headers: { "content-type": file.type } }) : new Response("Not found", { status: 404 });
};

beforeAll(() => {
  process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "ring-pictures-"));
  delete process.env.PINATA_JWT;
});

describe("a coin's picture", () => {
  it("is redrawn as a 512px square WebP whatever it arrived as", async () => {
    for (const format of ["png", "jpeg", "webp", "gif"] as const) {
      const cleaned = await sharp(await cleanPicture(await picture(format))).metadata();
      expect([cleaned.format, cleaned.width, cleaned.height]).toEqual(["webp", 512, 512]);
    }
  });

  it("loses hidden data carried in the file", async () => {
    const withLocation = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#fff" } })
      .withExif({ IFD0: { Copyright: "hidden-owner-name" }, GPS: { GPSLatitudeRef: "N" } } as never)
      .jpeg()
      .toBuffer();
    expect(withLocation.toString("latin1")).toContain("hidden-owner-name");
    const cleaned = await cleanPicture(withLocation.toString("base64"));
    expect(cleaned.toString("latin1")).not.toContain("hidden-owner-name");
    expect((await sharp(cleaned).metadata()).exif).toBeUndefined();
  });

  it("refuses what is not a picture, what is too large, and a drawing that could carry script", async () => {
    await expect(cleanPicture(Buffer.from("<html><script>alert(1)</script></html>").toString("base64"))).rejects.toThrow(/must be a PNG, JPEG, WebP or GIF/);
    await expect(cleanPicture(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64"))).rejects.toThrow(
      /must be a PNG, JPEG, WebP or GIF/,
    );
    await expect(cleanPicture(Buffer.alloc(PICTURE_MAX_BYTES + 1).toString("base64"))).rejects.toThrow(/larger than 1.5 MB/);
    await expect(cleanPicture("")).rejects.toThrow(/did not arrive intact/);
    await expect(cleanPicture("not base64 !!")).rejects.toThrow(/did not arrive intact/);
    // A real PNG header followed by rubbish.
    const broken = Buffer.concat([Buffer.from(await picture("png"), "base64").subarray(0, 40), Buffer.alloc(200, 7)]);
    await expect(cleanPicture(broken.toString("base64"))).rejects.toThrow(/could not be read|must be a PNG/);
  });
});

describe("where a coin's details are kept, without a picture store configured", () => {
  it("stores the picture and a description file on this server and says where each is", async () => {
    const kept = await storeCoinDetails({ name: "Lantern", symbol: "LNTRN", description: "A test coin.", picture: await picture("png") });
    // For this site's own pages the picture is a path, so it loads whatever address the site is reached at.
    expect(kept.image).toMatch(/^\/u\/[a-f0-9]{24}\.webp$/);
    expect(kept.uri).toMatch(/^http:\/\/localhost:4710\/u\/[a-f0-9]{24}\.json$/);
    const details = serve(kept.uri.split("/u/")[1]!);
    expect(details.status).toBe(200);
    expect(details.headers.get("content-type")).toBe("application/json");
    expect(await details.json()).toEqual({ name: "Lantern", symbol: "LNTRN", description: "A test coin.", image: `http://localhost:4710${kept.image}` });
    const image = serve(kept.image.split("/u/")[1]!);
    expect(image.headers.get("content-type")).toBe("image/webp");
    expect((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format).toBe("webp");
  });

  it("writes a description file with no picture when none was given, and the same details always get the same name", async () => {
    const first = await storeCoinDetails({ name: "Plain", symbol: "PLN", description: "" });
    const again = await storeCoinDetails({ name: "Plain", symbol: "PLN", description: "" });
    expect(first.image).toBe("");
    expect(first.uri).toBe(again.uri);
    expect(await serve(first.uri.split("/u/")[1]!).json()).toEqual({ name: "Plain", symbol: "PLN", description: "" });
  });

  it("serves only names it made itself: no paths, no other files", () => {
    for (const name of [
      "../state.json",
      "..%2Fstate.json",
      "state.json",
      "mock-ring-escrow.json",
      "a".repeat(24) + ".png",
      "A".repeat(24) + ".json",
      "",
      "x/y.webp",
    ]) {
      expect(storedFile(name)).toBeNull();
      expect(serve(name).status).toBe(404);
    }
    expect(serve(`${"0".repeat(24)}.webp`).status).toBe(404); // a well-formed name that does not exist
  });
});
