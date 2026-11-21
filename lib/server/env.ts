/** Server settings, all in one place. The Helius key is read here and never reaches the browser. */

export interface Settings {
  network: "local" | "devnet";
  rpcUrl: string;
  dataDir: string;
  /** For the devnet pass. Unused on a local validator. */
  heliusApiKey: string;
  /** How long one RPC call may take before it counts as a dead connection. */
  rpcTimeoutMs: number;
}

export function settings(): Settings {
  const network = process.env.RING_NETWORK ?? "local";
  if (network !== "local" && network !== "devnet") throw new Error('RING_NETWORK must be "local" or "devnet"');
  const rpcTimeoutMs = Number(process.env.RPC_TIMEOUT_MS ?? 20_000);
  if (!Number.isInteger(rpcTimeoutMs) || rpcTimeoutMs < 100) throw new Error("RPC_TIMEOUT_MS must be a whole number of milliseconds, 100 or more");
  return {
    network,
    rpcUrl: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8899",
    dataDir: process.env.APP_DATA_DIR ?? ".data",
    heliusApiKey: process.env.HELIUS_API_KEY ?? "",
    rpcTimeoutMs,
  };
}

/**
 * The mock Ring holds deposited coins in an escrow wallet whose key sits on this machine.
 * That is acceptable on a local validator, where coins are worthless, and nowhere else.
 */
export function assertLocalOnly(what: string): void {
  const { network, rpcUrl } = settings();
  const host = new URL(rpcUrl).hostname;
  if (network !== "local" || !["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    throw new Error(`${what} is a local-validator mock and refuses to run against ${host} (${network})`);
  }
}
