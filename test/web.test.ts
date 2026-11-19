import { describe, expect, it } from "vitest";
import { DEFAULT_PUBLIC_RPC, webConfig } from "../scripts/web.js";

const config = {
  strategyMint: "STRAT",
  burnMint: "DCTY",
  holderMint: "STRAT",
  minHold: "100000",
  expectedQuoteMint: null,
  reportTitle: "Dacity Strategy",
};

describe("public proof page config", () => {
  it("publishes only public facts and a key-free RPC", () => {
    const out = webConfig(config, "TREASURY", { quoteMint: "TTWO", repoUrl: "https://github.com/x/y" });
    expect(out).toEqual({
      title: "Dacity Strategy", treasury: "TREASURY", strategyMint: "STRAT", strategySymbol: "Dacity Strategy", burnMint: "DCTY", holderMint: "STRAT",
      quoteMint: "TTWO", split: { burn: 40, buyback: 20, holders: 40 }, minHold: "100000", holderSymbol: "strategy coin",
      rpcUrl: DEFAULT_PUBLIC_RPC, repoUrl: "https://github.com/x/y",
    });
    expect(JSON.stringify(out)).not.toMatch(/keypair|secret|RPC_URL/i);
  });
  it("names the coin after the holder symbol when holders are the coin's own, and carries the split", () => {
    const out = webConfig({ ...config, split: { burn: 50, buyback: 0, holders: 50 } }, "T", { holderSymbol: "DSTRAT" });
    expect(out.strategySymbol).toBe("DSTRAT");
    expect(out.holderSymbol).toBe("DSTRAT");
    expect(out.split).toEqual({ burn: 50, buyback: 0, holders: 50 });
    expect(webConfig({ ...config, holderMint: "OTHER" }, "T", { holderSymbol: "OTH" }).strategySymbol).toBe("Dacity Strategy");
  });
  it("falls back to EXPECTED_QUOTE_MINT, then to reading TTWO from the chain", () => {
    expect(webConfig({ ...config, expectedQuoteMint: "TTWO2" }, "T").quoteMint).toBe("TTWO2");
    expect(webConfig(config, "T").quoteMint).toBeNull();
    expect(webConfig(config, "T", { quoteMint: null }).quoteMint).toBeNull();
  });
  it("refuses a public RPC that is not https", () => {
    expect(() => webConfig(config, "T", { publicRpcUrl: "http://localhost:8899" })).toThrow(/https/);
  });
});
