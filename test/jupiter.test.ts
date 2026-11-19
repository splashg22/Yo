import { describe, expect, it } from "vitest";
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { parseConfig } from "../src/config.js";
import { checkSwapEffects, checkSwapTransaction, describeQuote, getQuote, getSwapTransaction } from "../src/jupiter.js";

const quoteBody = {
  inputMint: "TTWO", outputMint: "DCTY", inAmount: "1000", outAmount: "50000", otherAmountThreshold: "48500",
  routePlan: [{ swapInfo: { label: "Raydium" } }, { swapInfo: { label: "Pump.fun Amm" } }],
};
const respond = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const ask = { inputMint: "TTWO", outputMint: "DCTY", amount: 1000n, slippageBps: 300 };

function transaction(payer: Keypair, extraSigner?: Keypair) {
  const instructions = [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })];
  if (extraSigner) instructions.push(SystemProgram.transfer({ fromPubkey: extraSigner.publicKey, toPubkey: payer.publicKey, lamports: 1 }));
  return new VersionedTransaction(
    new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: "11111111111111111111111111111111", instructions }).compileToV0Message(),
  );
}

describe("Jupiter quote", () => {
  it("asks for an exact-in quote and sends the API key when there is one", async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string> };
      return new Response(JSON.stringify(quoteBody));
    }) as unknown as typeof fetch;
    const quote = await getQuote({ apiUrl: "https://jup.example/swap/v1/", apiKey: "k", fetchImpl }, ask);
    expect(seen!.url).toBe("https://jup.example/swap/v1/quote?inputMint=TTWO&outputMint=DCTY&amount=1000&slippageBps=300&swapMode=ExactIn");
    expect(seen!.headers["x-api-key"]).toBe("k");
    expect(describeQuote(quote)).toBe("Jupiter, 2 step(s) via Raydium -> Pump.fun Amm");
  });
  it("rejects a quote for a different pair or amount", async () => {
    const options = (body: unknown) => ({ apiUrl: "https://jup.example", apiKey: null, fetchImpl: respond(body) });
    await expect(getQuote(options({ ...quoteBody, outputMint: "SCAM" }), ask)).rejects.toThrow(/different pair/);
    await expect(getQuote(options({ ...quoteBody, inAmount: "999999" }), ask)).rejects.toThrow(/different input amount/);
  });
  it("surfaces an API error instead of guessing", async () => {
    const options = { apiUrl: "https://jup.example", apiKey: null, fetchImpl: respond({ error: "No routes found" }, 400) };
    await expect(getQuote(options, ask)).rejects.toThrow(/No routes found/);
  });
  it("decodes the swap transaction Jupiter returns", async () => {
    const payer = Keypair.generate();
    const swapTransaction = Buffer.from(transaction(payer).serialize()).toString("base64");
    const options = { apiUrl: "https://jup.example", apiKey: null, fetchImpl: respond({ swapTransaction, lastValidBlockHeight: 123 }) };
    const result = await getSwapTransaction(options, quoteBody, payer.publicKey.toBase58());
    expect(result.lastValidBlockHeight).toBe(123);
    expect(result.transaction.message.staticAccountKeys[0]!.equals(payer.publicKey)).toBe(true);
  });
});

describe("checks before signing a Jupiter transaction", () => {
  it("accepts a transaction paid and signed only by the treasury", () => {
    const treasury = Keypair.generate();
    expect(() => checkSwapTransaction(transaction(treasury), treasury.publicKey)).not.toThrow();
  });
  it("refuses a transaction paid by someone else or needing another signer", () => {
    const treasury = Keypair.generate();
    expect(() => checkSwapTransaction(transaction(Keypair.generate()), treasury.publicKey)).toThrow(/not paid for/);
    expect(() => checkSwapTransaction(transaction(treasury, Keypair.generate()), treasury.publicKey)).toThrow(/other than the treasury/);
  });

  const before = { lamports: 1_000_000_000n, quote: 5000n, coin: 700n };
  const limits = { amountIn: 1000n, minOut: 48_500n, maxLamports: 20_000_000n };
  it("accepts a swap that stays inside its limits", () => {
    const after = { lamports: 999_990_000n, quote: 4000n, coin: 50_700n };
    expect(checkSwapEffects(before, after, limits)).toEqual({ spent: 1000n, received: 50_000n });
  });
  it("refuses a swap that takes more TTWO than allowed", () => {
    expect(() => checkSwapEffects(before, { lamports: before.lamports, quote: 0n, coin: 60_000n }, limits)).toThrow(/more than the 1000 allowed/);
  });
  it("refuses a swap that delivers less than the minimum", () => {
    expect(() => checkSwapEffects(before, { lamports: before.lamports, quote: 4000n, coin: 800n }, limits)).toThrow(/less than the minimum/);
  });
  it("refuses a swap that drains SOL", () => {
    expect(() => checkSwapEffects(before, { lamports: 0n, quote: 4000n, coin: 50_700n }, limits)).toThrow(/lamports/);
  });
});

describe("swap and reward settings", () => {
  const mint = "So11111111111111111111111111111111111111112";
  const other = "9hjBLBrc7WZW2H8UQvBAvG5WiTZotXUv2Bdcn4f4pump";
  const env = {
    RPC_URL: "https://example.invalid", TREASURY_KEYPAIR_PATH: "/keys/t.json", STRATEGY_MINT: mint,
    BURN_MINT: other, MIN_HOLD: "1000", MAX_SWAP_TTWO_PER_CYCLE: "1",
  };
  it("rewards holders of the strategy coin unless told otherwise", () => {
    expect(parseConfig(env).holderMint).toBe(mint);
    expect(parseConfig({ ...env, HOLDER_MINT: other }).holderMint).toBe(other);
  });
  it("picks the swap venue automatically by default", () => {
    expect(parseConfig(env).swapVenue).toBe("auto");
    expect(parseConfig({ ...env, SWAP_VENUE: "jupiter" }).swapVenue).toBe("jupiter");
    expect(() => parseConfig({ ...env, SWAP_VENUE: "uniswap" })).toThrow(/SWAP_VENUE/);
  });
});
