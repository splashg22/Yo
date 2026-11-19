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
      title: "Dacity Strategy", treasury: "TREASURY", strategyMint: "STRAT", burnMint: "DCTY", holderMint: "STRAT",
      quoteMint: "TTWO", minHold: "100000", holderSymbol: "strategy coin", rpcUrl: DEFAULT_PUBLIC_RPC, repoUrl: "https://github.com/x/y",
    });
    expect(JSON.stringify(out)).not.toMatch(/keypair|secret|RPC_URL/i);
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
