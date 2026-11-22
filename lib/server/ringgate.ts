/**
 * The way to the real Privacy Rings services, for the browser.
 *
 * The Ring's SDK runs in the person's browser, with their keys. It has to reach three things at Helius: the
 * Solana RPC, the Ring's indexer and its prover. All three need the Helius key, which must never be in the
 * browser. So the browser talks to this server, and this server passes the call on with the key added.
 *
 * It is a narrow door, not an open relay:
 * - only the RPC methods the SDK uses are passed on;
 * - a transaction is passed on only if every program it calls is the Ring's own or one the Ring needs
 *   (the system program, the token programs);
 * - only paths under the Ring's own namespace are passed on, and nothing else on that host.
 *
 * What this server can see through it: which wallet's records a browser asks the indexer for, and when, and
 * every transaction it sends. What it cannot see: anything encrypted to the wallet's keys, or what goes to
 * the prover, which is encrypted to the prover's attested enclave by the SDK before it leaves the browser.
 */
import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { settings } from "./env";

/** Programs a transaction passed on to the chain may call. */
export const RING_PROGRAMS = new Set([
  "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW",
  "regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ",
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
]);
/** RPC methods the SDK uses. Reads of public chain data, and sending a transaction. */
const RPC_METHODS = new Set([
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getLatestBlockhash",
  "getSlot",
  "getBlockHeight",
  "getEpochInfo",
  "getMinimumBalanceForRentExemption",
  "getSignatureStatuses",
  "getTransaction",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getRecentPrioritizationFees",
  "simulateTransaction",
  "sendTransaction",
]);
const SPR_PATH = /^[A-Za-z0-9][A-Za-z0-9_-]*(\/[A-Za-z0-9_.-]+){0,4}$/;
const MAX_BODY = 1_500_000;

/** Whether the real Ring is reachable from this server: devnet, with a Helius key. Never on a local validator, never by accident. */
export function ringGateOpen(): boolean {
  const { network, heliusApiKey } = settings();
  return network === "devnet" && heliusApiKey !== "" && !process.env.DEVNET_RPC_URL;
}
const upstream = (): string => "https://devnet.helius-rpc.com";
/** Where the SDK fetches the signed policy that says which prover enclave to trust on devnet. Seen in its requests on 22 November 2026. */
export const TEE_POLICY_HOST = "https://d3gbdb0egjwcw9.cloudfront.net";

/** The programs a signed transaction calls, whatever its version. Throws if it cannot be read. */
export function programsOf(base64: string): string[] {
  const raw = Buffer.from(base64, "base64");
  const transaction = getTransactionDecoder().decode(raw);
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes) as unknown as {
    staticAccounts: string[];
    instructions?: { programAddressIndex: number }[];
    instructionHeaders?: { programAccountIndex: number }[];
    addressTableLookups?: unknown[];
  };
  // A program reached through a lookup table cannot be named from the transaction alone, so such a transaction is not passed on.
  if (message.addressTableLookups && message.addressTableLookups.length > 0) throw new Error("the transaction uses a lookup table");
  const indices =
    message.instructionHeaders?.map((header) => header.programAccountIndex) ??
    message.instructions?.map((instruction) => instruction.programAddressIndex) ??
    [];
  return [...new Set(indices.map((index) => message.staticAccounts[index] ?? "unknown"))];
}

export interface Passed {
  status: number;
  type: string;
  body: Buffer;
}
const refuse = (status: number, error: string): Passed => ({ status, type: "application/json", body: Buffer.from(JSON.stringify({ error })) });

/** Passes one call on, or refuses it. `route` is "rpc" or the path after "/v1/spr/". */
export async function passOn(route: string, method: string, query: URLSearchParams, body: Buffer | null): Promise<Passed> {
  if (!ringGateOpen()) return refuse(404, "the real Ring is not connected on this network in this build");
  if (body && body.length > MAX_BODY) return refuse(413, "the request is too large");
  const { heliusApiKey, rpcTimeoutMs } = settings();
  let target: URL;
  if (route === "rpc") {
    if (method !== "POST" || !body) return refuse(405, "the RPC is called with POST");
    let calls: unknown;
    try {
      calls = JSON.parse(body.toString("utf8"));
    } catch {
      return refuse(400, "the request body must be JSON");
    }
    for (const call of Array.isArray(calls) ? calls : [calls]) {
      const name = (call as { method?: unknown } | null)?.method;
      if (typeof name !== "string" || !RPC_METHODS.has(name)) return refuse(403, `this server does not pass on "${String(name)}"`);
      if (name === "sendTransaction" || name === "simulateTransaction") {
        const wire = (call as { params?: unknown[] }).params?.[0];
        let programs: string[];
        try {
          programs = programsOf(String(wire));
        } catch {
          return refuse(403, "this server passes on only transactions it can read");
        }
        const stranger = programs.find((program) => !RING_PROGRAMS.has(program));
        if (stranger || programs.length === 0) return refuse(403, "this server passes on only transactions for the Privacy Rings programs");
      }
    }
    target = new URL(upstream());
  } else {
    if (!SPR_PATH.test(route) || route.includes("..")) return refuse(404, "there is no such Ring service here");
    if (method !== "GET" && method !== "POST") return refuse(405, "that method is not passed on");
    target = new URL(`${upstream()}/v1/spr/${route}`);
    for (const [name, value] of query) if (name !== "api-key") target.searchParams.append(name, value);
  }
  target.searchParams.set("api-key", heliusApiKey);
  try {
    const answer = await fetch(target, {
      method,
      ...(body && method === "POST" ? { body: new Uint8Array(body), headers: { "content-type": "application/json" } } : {}),
      signal: AbortSignal.timeout(Math.max(rpcTimeoutMs, 60_000)), // a proof can take a while
    });
    return { status: answer.status, type: answer.headers.get("content-type") ?? "application/json", body: Buffer.from(await answer.arrayBuffer()) };
  } catch {
    return refuse(503, "the Ring's services are not answering. Nothing was sent. Try again in a moment.");
  }
}
