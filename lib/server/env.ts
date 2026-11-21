/** Server settings. The Helius key is read here and nowhere else, and never reaches the browser. */
export const NATIVE = "So11111111111111111111111111111111111111112"; // how SOL is named wherever a coin address is expected

export function settings() {
  const network = process.env.RING_NETWORK ?? "local";
  if (network !== "local" && network !== "devnet") throw new Error('RING_NETWORK must be "local" or "devnet"');
  return {
    network: network as "local" | "devnet",
    rpcUrl: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8899",
    dataDir: process.env.RINGPAD_DATA_DIR ?? ".data",
    /** For the devnet pass. Unused on a local validator. */
    heliusApiKey: process.env.HELIUS_API_KEY ?? "",
  };
}

/**
 * The mock Ring holds deposited coins in an escrow wallet whose key sits on this machine.
 * That is acceptable on a local validator, where coins are worthless, and nowhere else.
 */
export function assertLocalOnly(what: string): void {
  const { network, rpcUrl } = settings();
  const host = new URL(rpcUrl).hostname;
  if (network !== "local" || !["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`${what} is a local-validator mock and refuses to run against ${host} (${network})`);
  }
}
