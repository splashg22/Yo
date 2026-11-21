import { afterEach, describe, expect, it } from "vitest";
import { settings } from "../../lib/server/env";
import { contentSecurityPolicy, fixedHeaders } from "../../lib/server/headers";
import { previewAllows } from "../../lib/server/preview";
import { site } from "../../site.config";

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

describe("the private preview", () => {
  afterEach(() => delete process.env.PREVIEW_PASSWORD);

  it("lets everything through when no password is set", () => {
    expect(previewAllows(undefined)).toBe(true);
  });

  it("lets only the right password in once one is set", () => {
    process.env.PREVIEW_PASSWORD = "correct horse: battery";
    for (const wrong of [
      undefined,
      basic("anyone", "wrong"),
      basic("anyone", "correct horse: battery "),
      basic("anyone", ""),
      "Basic %%%not-base64%%%",
      "Bearer correct horse: battery",
    ])
      expect(previewAllows(wrong)).toBe(false);
    // Any user name; a password with a colon in it survives the user:password split.
    expect(previewAllows(basic("anyone", "correct horse: battery"))).toBe(true);
    expect(previewAllows(basic("", "correct horse: battery"))).toBe(true);
  });
});

describe("the security headers", () => {
  it("let scripts run only with the request's nonce, never from text, and forbid framing", () => {
    const policy = contentSecurityPolicy("abc123", { dev: false, imageHosts: [] });
    expect(policy).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic' 'wasm-unsafe-eval';");
    expect(policy).not.toContain(" 'unsafe-eval'");
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
    for (const rule of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "connect-src 'self'", "form-action 'self'"])
      expect(policy).toContain(rule);
    expect(contentSecurityPolicy("n", { dev: true, imageHosts: [] })).toContain("'unsafe-eval'"); // the framework's hot reload, in development only
    expect(contentSecurityPolicy("n", { dev: false, imageHosts: ["https://gateway.pinata.cloud"] })).toContain(
      "img-src 'self' data: blob: https://gateway.pinata.cloud",
    );
  });

  it("send HSTS only over HTTPS, and switch off every device permission", () => {
    expect(fixedHeaders(false)["strict-transport-security"]).toBeUndefined();
    expect(fixedHeaders(true)["strict-transport-security"]).toMatch(/max-age=63072000/);
    const permissions = fixedHeaders(true)["permissions-policy"]!;
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) expect(permissions).toContain(`${feature}=()`);
    expect(fixedHeaders(false)).toMatchObject({ "x-frame-options": "DENY", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
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
