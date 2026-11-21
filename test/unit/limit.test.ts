import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PER_MINUTE, bucketOf, callerOf, forgetLimits, overLimit } from "../../lib/server/limit";

describe("the ceiling on requests per address", () => {
  beforeEach(forgetLimits);

  it("lets a caller through up to the ceiling, then says how long to wait, then lets them through again a minute on", () => {
    const start = 1_000_000;
    for (let request = 0; request < PER_MINUTE.faucet; request++) expect(overLimit("203.0.113.7", "faucet", start + request)).toBe(0);
    expect(overLimit("203.0.113.7", "faucet", start + 20_000)).toBe(40);
    expect(overLimit("203.0.113.7", "faucet", start + 59_999)).toBe(1);
    expect(overLimit("203.0.113.7", "faucet", start + 60_000)).toBe(0);
  });

  it("counts each caller and each kind of request on its own", () => {
    for (let request = 0; request <= PER_MINUTE.faucet; request++) overLimit("203.0.113.7", "faucet", 5);
    expect(overLimit("203.0.113.7", "faucet", 6)).toBeGreaterThan(0);
    expect(overLimit("203.0.113.8", "faucet", 6)).toBe(0);
    expect(overLimit("203.0.113.7", "read", 6)).toBe(0);
  });

  it("puts anything that builds, sends or is signed by a wallet under the tighter ceiling", () => {
    expect(bucketOf("faucet")).toBe("faucet");
    for (const name of ["launch/build", "window/launch/build"]) expect(bucketOf(name)).toBe("launch"); // may carry a picture to decode
    for (const name of ["trade/build", "fees/build", "tx/send", "ring/transfer", "ring/withdraw", "ring/mine", "ring/reconcile", "otc/accept"])
      expect(bucketOf(name)).toBe("write");
    for (const name of ["explore", "coin", "coin/prices", "coin/activity", "wallet/public", "status", "stats", "config", "tx/status"])
      expect(bucketOf(name)).toBe("read");
    expect(PER_MINUTE.launch).toBeLessThan(PER_MINUTE.write);
    expect(PER_MINUTE.faucet).toBeLessThan(PER_MINUTE.write);
    expect(PER_MINUTE.write).toBeLessThan(PER_MINUTE.read);
  });
});

describe("who a request is counted against", () => {
  afterEach(() => delete process.env.TRUSTED_PROXY_HOPS);

  it("ignores the forwarding header unless the operator has said there are proxies of their own in front", () => {
    expect(callerOf("203.0.113.7")).toBe("direct");
    expect(callerOf(null)).toBe("direct");
    process.env.TRUSTED_PROXY_HOPS = "1";
    // With one proxy of ours in front, the last entry is the one it added. Anything before it was written by the caller.
    expect(callerOf("1.2.3.4, 203.0.113.7")).toBe("203.0.113.7");
    expect(callerOf("spoofed, also-spoofed, 198.51.100.9")).toBe("198.51.100.9");
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(callerOf("spoofed, 198.51.100.9, 10.0.0.1")).toBe("198.51.100.9");
    expect(callerOf("10.0.0.1")).toBe("direct"); // fewer entries than proxies: nothing to trust
    process.env.TRUSTED_PROXY_HOPS = "many";
    expect(callerOf("203.0.113.7")).toBe("direct");
  });
});
