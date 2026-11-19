import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { listBrands, loadBrand, parseBrand } from "../src/brand.js";
import { parseConfig } from "../src/config.js";
import { envFileFor, pickEnvFile } from "../src/env.js";
import { formatCycleMessage } from "../src/notify.js";
// @ts-expect-error plain JavaScript shared with the browser page
import * as proof from "../web/proof.js";

const mint = Keypair.generate().publicKey.toBase58();
const base = { RPC_URL: "https://rpc.example", TREASURY_KEYPAIR_PATH: "/tmp/k.json", STRATEGY_MINT: mint, MIN_HOLD: "1000", MAX_SWAP_PER_CYCLE: "1" };

describe("brands", () => {
  it("ships DA City and LLM Launchpad", () => {
    expect(listBrands()).toEqual(expect.arrayContaining(["dacity", "llm"]));
    expect(loadBrand(undefined).name).toBe("dacity");
    expect(loadBrand("llm")).toMatchObject({ title: "LLM Launchpad", slug: "llm", quoteSymbol: "ANT", burnMint: null });
  });
  it("refuses an unknown or malformed brand", () => {
    expect(() => loadBrand("nope")).toThrow(/no brands\/nope\.json.*dacity/);
    expect(() => loadBrand("../x")).toThrow(/BRAND must be/);
    expect(() => parseBrand("x", { slug: "Bad Slug" })).toThrow(/slug/);
    expect(() => parseBrand("x", { slug: "", title: "" })).toThrow(/title/);
  });
});

describe("settings per coin", () => {
  it("DA City keeps its tickers, burn coin and data folder", () => {
    const config = parseConfig(base);
    expect(config).toMatchObject({ quoteSymbol: "TTWO", burnSymbol: "DCTY", holderSymbol: "", dataDir: "data", reportTitle: "DA City strategy" });
    expect(config.burnMint).toBe("9hjBLBrc7WZW2H8UQvBAvG5WiTZotXUv2Bdcn4f4pump");
  });
  it("LLM Launchpad is paired with ANT, buys back and burns itself, and keeps separate books", () => {
    const config = parseConfig({ ...base, BRAND: "llm" });
    expect(config).toMatchObject({ quoteSymbol: "ANT", burnSymbol: "LLM", holderSymbol: "LLM", dataDir: "data/llm", reportTitle: "LLM Launchpad" });
    expect(config.burnMint).toBe(mint);
    expect(config.holderMint).toBe(mint);
  });
  it("lets .env override the burn coin and the tickers", () => {
    const other = Keypair.generate().publicKey.toBase58();
    const config = parseConfig({ ...base, BRAND: "llm", BURN_MINT: other, BURN_SYMBOL: "XYZ", QUOTE_SYMBOL: "ANTx", COIN_SYMBOL: "LLMX" });
    expect(config).toMatchObject({ burnMint: other, burnSymbol: "XYZ", quoteSymbol: "ANTx", holderSymbol: "LLMX" });
  });
  it("still reads the old TTWO-named amount settings", () => {
    const { MAX_SWAP_PER_CYCLE: _dropped, ...rest } = base;
    expect(parseConfig({ ...rest, MAX_SWAP_TTWO_PER_CYCLE: "2", MIN_PAYOUT_TTWO: "0.5" })).toMatchObject({ maxSwapPerCycle: "2", minPayout: "0.5" });
    expect(parseConfig({ ...base, MAX_SWAP_TTWO_PER_CYCLE: "2", MIN_PAYOUT: "0.1", MIN_PAYOUT_TTWO: "0.5" })).toMatchObject({ maxSwapPerCycle: "1", minPayout: "0.1" });
    expect(() => parseConfig(rest)).toThrow(/MAX_SWAP_PER_CYCLE is not set/);
  });
});

describe("choosing the settings file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brands-"));
  fs.mkdirSync(path.join(root, "brands"));
  for (const name of ["dacity", "llm"]) fs.writeFileSync(path.join(root, "brands", `${name}.json`), "{}");

  it("uses .env unless told otherwise", () => {
    expect(pickEnvFile(["status"], {}, root)).toEqual({ file: path.join(root, ".env"), brand: null, rest: ["status"] });
    expect(pickEnvFile(["loop"], { ENV_FILE: "x.env" }, root).file).toBe(path.join(root, "x.env"));
  });
  it("takes a coin's name anywhere on the command line", () => {
    expect(pickEnvFile(["status", "llm"], {}, root)).toEqual({ file: path.join(root, ".env.llm"), brand: "llm", rest: ["status"] });
    expect(pickEnvFile(["verify", "llm", "3"], {}, root)).toEqual({ file: path.join(root, ".env.llm"), brand: "llm", rest: ["verify", "3"] });
    expect(pickEnvFile(["cycle", "dacity"], {}, root).file).toBe(path.join(root, ".env"));
    expect(envFileFor("llm", root)).toBe(path.join(root, ".env.llm"));
  });
  it("takes an explicit file, and leaves unknown words for the command to refuse", () => {
    expect(pickEnvFile(["--env=/etc/bot.env", "cycle"], {}, root)).toEqual({ file: "/etc/bot.env", brand: null, rest: ["cycle"] });
    expect(pickEnvFile(["cycle", "lllm"], {}, root).rest).toEqual(["cycle", "lllm"]);
    expect(() => pickEnvFile(["--env="], {}, root)).toThrow(/needs a file/);
  });
});

describe("tickers in messages", () => {
  const report = { cycle: 4, claimed: 1000n, swapped: 500n, burned: 5000n, paid: 500n, recipients: 2, skipped: [], notes: [] };
  it("names the coin and its tickers in alerts", () => {
    const text = formatCycleMessage(report, { quoteDecimals: 2, burnDecimals: 0, quoteSymbol: "ANT", burnSymbol: "LLM", title: "LLM Launchpad" });
    expect(text).toBe("LLM Launchpad · cycle 4\nClaimed 10 ANT\nBurned 5000 LLM (spent 5 ANT)\nPaid 5 ANT to 2 holders");
  });
  it("names them on the proof page, including a coin that buys itself back", () => {
    const T = "TREASURY", COIN = "COIN", ANT = "ANT_MINT";
    const cfg = { treasury: T, burnMint: COIN, quoteMint: ANT, quoteSymbol: "ANT", burnSymbol: "LLM" };
    const bal = (accountIndex: number, m: string, owner: string, amount: string) => ({ accountIndex, mint: m, owner, uiTokenAmount: { amount, decimals: 6 } });
    const tx = { meta: { err: null, preBalances: [10], postBalances: [9], innerInstructions: [],
      preTokenBalances: [bal(1, ANT, T, "1000000"), bal(2, COIN, T, "0")], postTokenBalances: [bal(1, ANT, T, "250000"), bal(2, COIN, T, "42000000")] },
      transaction: { message: { accountKeys: [T, "A", "B", proof.PUMP_PROGRAM], instructions: [{ programId: proof.PUMP_PROGRAM }] } } };
    const row = proof.classify(cfg, "s", 1, tx);
    expect(row).toMatchObject({ kind: "buy", text: "Bought LLM with ANT on pump", amount: "0.75 ANT → 42 LLM" });
  });
});
