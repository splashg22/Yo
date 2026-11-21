/**
 * One-off set-up on devnet: makes the table of accounts that lets a launch with a first buy fit in
 * one transaction. Needs RING_NETWORK=devnet and HELIUS_API_KEY (or DEVNET_RPC_URL).
 *
 * Run it once. It prints the address of a devnet-only operator wallet; send that wallet about 0.1
 * devnet SOL from https://faucet.solana.com and run it again.           Run: npm run devnet:setup
 * NOT VERIFIED against real devnet: the faucet is closed to the machine this was written on. It is
 * tested against a local chain standing in for devnet (test/flows/devnet-mode.test.ts).
 */
import { PublicKey } from "@solana/web3.js";
import { makeLookupTable } from "../lib/server/bootstrap";
import { settings } from "../lib/server/env";
import { devnetOpsKey } from "../lib/server/opskey";
import { connection } from "../lib/server/solana";
import { durable, ready, state } from "../lib/server/store";

const NEEDED_LAMPORTS = 50_000_000;

export async function devnetSetup(say: (line: string) => void = console.log): Promise<"funded-needed" | "ready"> {
  if (settings().network !== "devnet") throw new Error("set RING_NETWORK=devnet first");
  await ready();
  const chain = connection();
  const known = state().lookupTable;
  if (known && (await chain.getAccountInfo(new PublicKey(known)))) {
    say(`The lookup table already exists: ${known}`);
    return "ready";
  }
  const payer = devnetOpsKey();
  const balance = await chain.getBalance(payer.publicKey);
  if (balance < NEEDED_LAMPORTS) {
    say(`Operator wallet (devnet only): ${payer.publicKey.toBase58()}`);
    say(`It holds ${balance / 1e9} SOL and needs about ${NEEDED_LAMPORTS / 1e9}. Send it devnet SOL from https://faucet.solana.com, then run this again.`);
    return "funded-needed";
  }
  const table = await makeLookupTable(payer, false);
  await durable();
  say(`Lookup table made: ${table}`);
  return "ready";
}

if (process.argv[1]?.endsWith("devnet-setup.ts")) {
  process.exit((await devnetSetup()) === "ready" ? 0 : 2);
}
