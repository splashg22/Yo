import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PUBLIC_RPC, renderSite, siteDir, webConfig } from "../scripts/web.js";
import { loadBrand } from "../src/brand.js";

const dacity = loadBrand("dacity");
const llm = loadBrand("llm");
const config = {
  brand: dacity,
  quoteSymbol: "TTWO",
  burnSymbol: "DCTY",
  holderSymbol: "",
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
      title: "Dacity Strategy", theme: "dacity", treasury: "TREASURY", strategyMint: "STRAT", burnMint: "DCTY", holderMint: "STRAT",
      quoteMint: "TTWO", minHold: "100000", holderSymbol: "strategy coin",
      quoteSymbol: "TTWO", quoteName: "tokenized Take-Two stock", burnSymbol: "DCTY", burnName: "DacityCoin",
      notAffiliatedWith: "Take-Two Interactive, the TTWO issuer or pump.fun",
      rpcUrl: DEFAULT_PUBLIC_RPC, repoUrl: "https://github.com/x/y",
    });
    expect(JSON.stringify(out)).not.toMatch(/keypair|secret|RPC_URL/i);
  });
  it("carries another coin's tickers and theme", () => {
    const out = webConfig({ ...config, brand: llm, quoteSymbol: "ANT", burnSymbol: "LLM", holderSymbol: "LLM", burnMint: "STRAT", reportTitle: llm.title }, "T");
    expect(out).toMatchObject({ title: "LLM Launchpad", theme: "llm", quoteSymbol: "ANT", quoteName: "tokenized Anthropic stock", burnSymbol: "LLM", burnName: "LLM", holderSymbol: "LLM" });
    expect(out.notAffiliatedWith).toMatch(/Anthropic/);
  });
  it("falls back to EXPECTED_QUOTE_MINT, then to reading the pair from the chain", () => {
    expect(webConfig({ ...config, expectedQuoteMint: "TTWO2" }, "T").quoteMint).toBe("TTWO2");
    expect(webConfig(config, "T").quoteMint).toBeNull();
    expect(webConfig(config, "T", { quoteMint: null }).quoteMint).toBeNull();
  });
  it("refuses a public RPC that is not https", () => {
    expect(() => webConfig(config, "T", { publicRpcUrl: "http://localhost:8899" })).toThrow(/https/);
  });
});

describe("a brand's own page", () => {
  const template = fs.readFileSync(path.join("web", "index.html"), "utf8");
  const page = renderSite(template, llm);

  it("lives in its own folder, the default brand at the top", () => {
    expect(siteDir(dacity, "web")).toBe("web");
    expect(siteDir(llm, "web")).toBe(path.join("web", "llm"));
  });
  it("carries the brand in the HTML itself: theme, title, link preview, words", () => {
    expect(page).toContain('<html lang="en" data-theme="llm">');
    expect(page).toContain("<title>LLM Launchpad</title>");
    expect(page).toContain('<meta property="og:title" content="LLM Launchpad">');
    expect(page).toContain('<span class="blue" data-b="quote">ANT</span>');
    expect(page).toContain('<span data-b="quoteName">tokenized Anthropic stock</span>');
    expect(page).toContain('from "../proof.js"');
    expect(page).toContain('let Q = "ANT", B = "LLM";');
  });
  it("leaves nothing of the default brand behind", () => {
    expect(page).not.toMatch(/TTWO|DCTY|Dacity|Take-Two/);
  });
  it("says who it is not affiliated with", () => {
    expect(page).toMatch(/Not affiliated with <span data-b="notAffiliatedWith">Anthropic, /);
  });
  it("escapes brand text and refuses a template it no longer understands", () => {
    expect(renderSite(template, { ...llm, title: "<b>x</b>" })).toContain("<title>&lt;b&gt;x&lt;/b&gt;</title>");
    expect(() => renderSite(template.replace(/data-b="burnName"/g, ""), llm)).toThrow(/burnName/);
    expect(() => renderSite(template.replace("<title>", "<x>"), llm)).toThrow(/title/);
    expect(() => renderSite(template, { ...llm, quoteSymbol: 'A"NT' })).toThrow(/ticker/);
  });
  it("is committed up to date (run `npm run web:sites` after editing web/index.html)", () => {
    expect(fs.readFileSync(path.join("web", "llm", "index.html"), "utf8")).toBe(page);
  });
});
