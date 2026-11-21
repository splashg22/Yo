import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PER_MINUTE, bucketOf, forgetLimits, overLimit } from "../../lib/server/limit";
import { forget, state } from "../../lib/server/store";

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
    for (const name of ["launch/build", "trade/build", "fees/build", "tx/send", "ring/transfer", "ring/withdraw", "ring/mine", "ring/reconcile", "otc/accept"])
      expect(bucketOf(name)).toBe("write");
    for (const name of ["explore", "coin", "coin/prices", "coin/activity", "wallet/public", "status", "stats", "config", "tx/status"])
      expect(bucketOf(name)).toBe("read");
    expect(PER_MINUTE.faucet).toBeLessThan(PER_MINUTE.write);
    expect(PER_MINUTE.write).toBeLessThan(PER_MINUTE.read);
  });
});

describe("a damaged state file", () => {
  it("stops the server with a clear message and is left untouched, rather than starting again from empty", () => {
    const directory = mkdtempSync(join(tmpdir(), "ring-state-"));
    const previous = process.env.APP_DATA_DIR;
    process.env.APP_DATA_DIR = directory;
    forget();
    try {
      for (const contents of ['{"balances": {"a"', "[]", "null"]) {
        writeFileSync(join(directory, "state.json"), contents);
        expect(() => state()).toThrow(/state file .* is damaged .* left untouched/);
        forget();
      }
    } finally {
      if (previous === undefined) delete process.env.APP_DATA_DIR;
      else process.env.APP_DATA_DIR = previous;
      forget();
    }
  });
});
