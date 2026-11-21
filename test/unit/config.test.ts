import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { settings } from "../../lib/server/env";
import { POST } from "../../app/api/[...op]/route";
import { proxy } from "../../proxy";
import { site } from "../../site.config";

const visit = (path: string, authorization?: string) =>
  proxy(new NextRequest(`http://localhost:4710${path}`, authorization ? { headers: { authorization } } : undefined));
const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

describe("the private preview", () => {
  afterEach(() => delete process.env.PREVIEW_PASSWORD);

  it("serves everything when no password is set", () => {
    expect(visit("/").status).toBe(200);
    expect(visit("/api/explore").status).toBe(200);
  });

  it("asks for the password on every page and request once one is set, and lets only the right one in", () => {
    process.env.PREVIEW_PASSWORD = "correct horse: battery";
    for (const path of ["/", "/wallet", "/api/explore", "/media/og.png"]) {
      const refused = visit(path);
      expect(refused.status).toBe(401);
      expect(refused.headers.get("www-authenticate")).toMatch(/^Basic /);
    }
    expect(visit("/", basic("anyone", "wrong")).status).toBe(401);
    expect(visit("/", basic("anyone", "correct horse: battery ")).status).toBe(401);
    expect(visit("/", basic("anyone", "")).status).toBe(401);
    expect(visit("/", "Basic %%%not-base64%%%").status).toBe(401);
    expect(visit("/", "Bearer correct horse: battery").status).toBe(401);
    // Any user name; a password with a colon in it survives the user:password split.
    expect(visit("/", basic("anyone", "correct horse: battery")).status).toBe(200);
    expect(visit("/api/explore", basic("", "correct horse: battery")).status).toBe(200);
  });

  it("leaves only the health check open", () => {
    process.env.PREVIEW_PASSWORD = "secret";
    expect(visit("/health").status).toBe(200);
    expect(visit("/health/").status).toBe(401);
    expect(visit("/healthy").status).toBe(401);
  });
});

describe("feature flags", () => {
  afterEach(() => delete process.env.FEATURE_SEALED_WINDOW);

  it("keep the sealed launch window off unless it is switched on by name, and refuse any other value", () => {
    expect(settings().features.sealedWindow).toBe(false);
    process.env.FEATURE_SEALED_WINDOW = "on";
    expect(settings().features.sealedWindow).toBe(true);
    process.env.FEATURE_SEALED_WINDOW = "off";
    expect(settings().features.sealedWindow).toBe(false);
    for (const wrong of ["true", "1", "yes", "ON", ""]) {
      process.env.FEATURE_SEALED_WINDOW = wrong;
      expect(() => settings()).toThrow(/must be "on" or "off"/);
    }
  });
});

describe("who runs the site", () => {
  it("is a marked placeholder until the owner fills it in, never an invented name", () => {
    for (const value of Object.values(site.operator)) expect(value).toMatch(/^\[.*TO BE FILLED IN\]$/);
  });
});

describe("the size of a request", () => {
  const send = (body: string, declared?: string) =>
    POST(new NextRequest("http://localhost:4710/api/config", { method: "POST", body, headers: declared ? { "content-length": declared } : undefined }), {
      params: Promise.resolve({ op: ["config"] }),
    });

  it("is refused before it is read when it says it is too large, and after if it lied", async () => {
    expect((await send("{}", "999999999")).status).toBe(413);
    expect((await send("{}", "not-a-number")).status).toBe(413);
    const oversized = await send(JSON.stringify({ padding: "x".repeat(2_400_000) }));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: "the request is too large" });
  });

  it("answers an ordinary request, and says plainly when the body is not a JSON object", async () => {
    expect((await send("{}")).status).toBe(200);
    for (const body of ["", "not json", "[]", "null", "7"]) {
      const refused = await send(body);
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({ error: "the request body must be a JSON object" });
    }
  });
});
