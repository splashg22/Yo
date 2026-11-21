/**
 * The operator's working key on devnet: it pays for the launch lookup table and nothing else.
 * It holds test SOL only and is made on the server's disk the first time it is asked for.
 * There is no mainnet version of this file: a mainnet key is the owner's to create and hold.
 */
import { Keypair } from "@solana/web3.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { settings } from "./env";

export function devnetOpsKey(): Keypair {
  const { network, dataDir } = settings();
  if (network !== "devnet") throw new Error("the devnet operator key is for devnet only");
  const path = join(dataDir, "devnet-ops.json");
  if (existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
  const key = Keypair.generate();
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path, JSON.stringify([...key.secretKey]), { mode: 0o600 });
  return key;
}
