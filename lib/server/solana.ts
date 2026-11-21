/** The connection to the chain, and turning its failures into sentences a person can act on. */
import { Connection } from "@solana/web3.js";
import { settings } from "./env";

let cached: { url: string; timeout: number; connection: Connection } | undefined;

/** How many calls have gone to the chain since the start, by method. Read by the health page and by tests that hold reads to a budget. */
export const rpcCalls = new Map<string, number>();
export const rpcCallTotal = (): number => [...rpcCalls.values()].reduce((sum, count) => sum + count, 0);
function count(body: unknown): void {
  if (typeof body !== "string") return;
  for (const match of body.matchAll(/"method":"(\w+)"/g)) rpcCalls.set(match[1]!, (rpcCalls.get(match[1]!) ?? 0) + 1);
}

/** One connection per RPC address. Every call gives up after the configured timeout instead of hanging. */
export function connection(): Connection {
  const { rpcUrl, rpcTimeoutMs } = settings();
  if (cached?.url !== rpcUrl || cached.timeout !== rpcTimeoutMs) {
    const timed: typeof fetch = (input, init) => {
      count(init?.body);
      return fetch(input, { ...init, signal: AbortSignal.timeout(rpcTimeoutMs) });
    };
    cached = {
      url: rpcUrl,
      timeout: rpcTimeoutMs,
      connection: new Connection(rpcUrl, { commitment: "confirmed", fetch: timed, disableRetryOnRateLimit: true }),
    };
  }
  return cached.connection;
}

const logsOf = (error: unknown): string[] => {
  const logs = (error as { logs?: unknown; transactionLogs?: unknown }).logs ?? (error as { transactionLogs?: unknown }).transactionLogs;
  return Array.isArray(logs) ? logs.filter((line): line is string => typeof line === "string") : [];
};

/** True when the failure means the chain could not be reached at all, so nothing was sent. */
export function isUnreachable(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  const causeText = cause instanceof Error ? `${cause.name} ${cause.message}` : typeof cause === "string" ? cause : "";
  const message = error instanceof Error ? `${error.name} ${error.message} ${causeText}` : String(error);
  return /TimeoutError|AbortError|fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|operation was aborted|timed out/i.test(message);
}

/** One plain sentence for any failure from the chain. */
export function explain(error: unknown): string {
  if (isUnreachable(error)) return "the chain is not answering. Nothing was sent. Try again in a moment.";
  const message = error instanceof Error ? error.message : String(error);
  const logs = logsOf(error).join("\n");
  const everything = `${message}\n${logs}`;
  if (
    /insufficient lamports|insufficient funds|Attempt to debit an account but found no record of a prior credit|InsufficientFundsForRent|custom program error: 0x1\b/i.test(
      everything,
    )
  ) {
    return "there is not enough in the wallet for this, including the network fee";
  }
  if (/Blockhash not found|block height exceeded|TransactionExpired/i.test(everything))
    return "the transaction expired before it reached the chain. Review and sign it again.";
  if (/already been processed/i.test(everything)) return "this transaction was already sent";
  const programReason = /Error Message: (.+?)\.{0,2}$/m.exec(everything)?.[1];
  if (programReason) return `the program refused it: ${programReason}`;
  return message.split("\n")[0]!.slice(0, 240);
}
