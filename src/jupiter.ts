/**
 * Jupiter swap, used when pump has no direct route from TTWO to the burn coin
 * (for example because the burn coin trades against SOL).
 *
 * Jupiter hands back a ready-made transaction. It is built by a third party,
 * so nothing here is trusted: before the bot signs it, `checkSwapTransaction`
 * and `checkSwapEffects` verify who pays, who signs and what would move.
 */
import { PublicKey, VersionedTransaction } from "@solana/web3.js";

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  routePlan?: { swapInfo?: { label?: string } }[];
  [key: string]: unknown;
}

export interface JupiterOptions {
  apiUrl: string;
  apiKey: string | null;
  fetchImpl?: typeof fetch;
}

async function call<T>(options: JupiterOptions, path: string, init?: RequestInit): Promise<T> {
  const fetcher = options.fetchImpl ?? fetch;
  const response = await fetcher(`${options.apiUrl.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(options.apiKey ? { "x-api-key": options.apiKey } : {}),
    },
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Jupiter answered HTTP ${response.status} with something that is not JSON`);
  }
  const error = (body as { error?: unknown; message?: unknown }).error;
  if (!response.ok || error) {
    const detail = error ?? (body as { message?: unknown }).message ?? text.slice(0, 200);
    throw new Error(`Jupiter refused (HTTP ${response.status}): ${String(detail)}`);
  }
  return body as T;
}

export async function getQuote(
  options: JupiterOptions,
  params: { inputMint: string; outputMint: string; amount: bigint; slippageBps: number },
): Promise<JupiterQuote> {
  const query = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount.toString(),
    slippageBps: String(params.slippageBps),
    swapMode: "ExactIn",
  });
  const quote = await call<JupiterQuote>(options, `/quote?${query.toString()}`);
  if (quote.inputMint !== params.inputMint || quote.outputMint !== params.outputMint) {
    throw new Error("Jupiter quoted a different pair than the one asked for");
  }
  if (BigInt(quote.inAmount) !== params.amount) {
    throw new Error("Jupiter quoted a different input amount than the one asked for");
  }
  return quote;
}

export async function getSwapTransaction(
  options: JupiterOptions,
  quote: JupiterQuote,
  user: string,
): Promise<{ transaction: VersionedTransaction; lastValidBlockHeight: number }> {
  const body = await call<{ swapTransaction?: string; lastValidBlockHeight?: number }>(options, "/swap", {
    method: "POST",
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: user,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  });
  if (!body.swapTransaction || typeof body.lastValidBlockHeight !== "number") {
    throw new Error("Jupiter did not return a swap transaction");
  }
  return {
    transaction: VersionedTransaction.deserialize(Buffer.from(body.swapTransaction, "base64")),
    lastValidBlockHeight: body.lastValidBlockHeight,
  };
}

export function describeQuote(quote: JupiterQuote): string {
  const labels = (quote.routePlan ?? []).map((step) => step.swapInfo?.label ?? "unknown venue");
  return `Jupiter, ${labels.length} step(s) via ${labels.join(" -> ") || "unknown venue"}`;
}

/** The treasury must be the fee payer and the only signature required. */
export function checkSwapTransaction(transaction: VersionedTransaction, treasury: PublicKey): void {
  const { header, staticAccountKeys } = transaction.message;
  if (!staticAccountKeys[0]?.equals(treasury)) {
    throw new Error("the Jupiter transaction is not paid for by the treasury");
  }
  if (header.numRequiredSignatures !== 1) {
    throw new Error("the Jupiter transaction asks for signatures other than the treasury's");
  }
}

export interface Holdings {
  lamports: bigint;
  quote: bigint;
  coin: bigint;
}

/**
 * Compares the treasury before and after a SIMULATION of the swap. It may
 * spend at most `amountIn` TTWO and `maxLamports` SOL (network fees and
 * account rent), and must receive at least `minOut` of the burn coin.
 */
export function checkSwapEffects(
  before: Holdings,
  after: Holdings,
  limits: { amountIn: bigint; minOut: bigint; maxLamports: bigint },
): { spent: bigint; received: bigint } {
  const spent = before.quote - after.quote;
  const received = after.coin - before.coin;
  const lamports = before.lamports - after.lamports;
  if (spent > limits.amountIn) {
    throw new Error(`the swap would take ${spent} TTWO base units, more than the ${limits.amountIn} allowed`);
  }
  if (spent <= 0n) throw new Error("the swap would not spend any TTWO");
  if (received < limits.minOut) {
    throw new Error(`the swap would deliver ${received} burn-coin base units, less than the minimum ${limits.minOut}`);
  }
  if (lamports > limits.maxLamports) {
    throw new Error(`the swap would take ${lamports} lamports of SOL, more than the ${limits.maxLamports} allowed`);
  }
  return { spent, received };
}
