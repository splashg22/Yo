import { describe, expect, it } from "vitest";
import { parseHandedPrice } from "../../lib/price-header";

describe("the price the server hands to the page", () => {
  it("is read back as it was written", () => {
    const price = { usd: 151.25, at: 1_800_000_000_000, source: "Pyth SOL/USD, read from the chain" };
    expect(parseHandedPrice(JSON.stringify(price))).toEqual(price);
  });
  it("is no price when it is missing or is anything but a price", () => {
    for (const text of [
      null,
      undefined,
      "",
      "150",
      "null",
      "{}",
      "{not json",
      '{"usd":-1,"at":1,"source":"x"}',
      '{"usd":"150","at":1,"source":"x"}',
      '{"usd":150,"at":1}',
      '{"usd":1e999,"at":1,"source":"x"}',
    ])
      expect(parseHandedPrice(text), String(text)).toBeNull();
  });
  it("keeps only the fields of a price, and a source of sensible length", () => {
    const read = parseHandedPrice(JSON.stringify({ usd: 150, at: 5, source: "s".repeat(500), extra: "<script>" }));
    expect(read).toEqual({ usd: 150, at: 5, source: "s".repeat(120) });
  });
});

describe("the build's settings the server hands to the page", () => {
  const config = { network: "devnet", ring: "real", features: { sealedWindow: false }, fees: { wallet: "", tradeBps: 0, launchLamports: "0", otcBps: 0 } };
  it("are read back as they were written", async () => {
    const { parseHandedConfig } = await import("../../lib/price-header");
    expect(parseHandedConfig(JSON.stringify(config))).toEqual(config);
  });
  it("carry the read-only mainnet mode, and a recording's times when one is being played back", async () => {
    const { parseHandedConfig } = await import("../../lib/price-header");
    const mainnet = { ...config, network: "mainnet", ring: "unavailable" };
    expect(parseHandedConfig(JSON.stringify(mainnet))).toEqual(mainnet);
    const recording = { from: 1_795_324_000_000, to: 1_795_324_129_000, now: 1_795_324_060_000 };
    expect(parseHandedConfig(JSON.stringify({ ...mainnet, recording }))).toEqual({ ...mainnet, recording });
    // A recording that is not three plain moments is dropped; the rest of the settings stand.
    expect(parseHandedConfig(JSON.stringify({ ...mainnet, recording: { from: "then", to: 2, now: 3 } }))).toEqual(mainnet);
  });
  it("are no settings when anything about them is off, so the page asks the server instead of trusting them", async () => {
    const { parseHandedConfig } = await import("../../lib/price-header");
    for (const wrong of [
      null,
      "",
      "{not json",
      JSON.stringify({ ...config, network: "testnet" }),
      JSON.stringify({ ...config, ring: "on" }),
      JSON.stringify({ ...config, features: {} }),
      JSON.stringify({ ...config, fees: { ...config.fees, tradeBps: -1 } }),
      JSON.stringify({ ...config, fees: { ...config.fees, launchLamports: "1e9" } }),
      JSON.stringify({ ...config, fees: undefined }),
    ])
      expect(parseHandedConfig(wrong), String(wrong)).toBeNull();
  });
});
