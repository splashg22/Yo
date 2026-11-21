/**
 * Copies the programs and accounts listed in local/clone.json from devnet into
 * local/accounts/, in the form solana-test-validator loads with --account.
 * After this the local validator starts without any network. Run: npm run local:fetch
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const connection = new Connection(process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const plan = JSON.parse(readFileSync("local/clone.json", "utf8")) as { programs: string[]; accounts: string[]; extra?: string[] };
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
mkdirSync("local/accounts", { recursive: true });

async function save(key: string, patch?: (data: Buffer) => void) {
  const info = await connection.getAccountInfo(new PublicKey(key));
  if (!info) { console.log("not on devnet, skipped:", key); return null; }
  const data = Buffer.from(info.data);
  patch?.(data);
  writeFileSync(`local/accounts/${key}.json`, JSON.stringify({
    pubkey: key,
    account: { lamports: info.lamports, data: [data.toString("base64"), "base64"], owner: info.owner.toBase58(), executable: info.executable, rentEpoch: 0, space: data.length },
  }));
  return info;
}

let count = 0;
for (const program of plan.programs) {
  const info = await save(program);
  if (!info) continue;
  count += 1;
  if (info.owner.toBase58() === LOADER) {
    // The program's code lives in a second account. Its header records the slot it was
    // deployed in; a fresh local chain starts at slot 0, so that is reset.
    const programData = new PublicKey(info.data.subarray(4, 36)).toBase58();
    await save(programData, (data) => data.writeBigUInt64LE(0n, 4));
    count += 1;
  }
}
for (const account of [...plan.accounts, ...(plan.extra ?? [])]) if (await save(account)) count += 1;
console.log(`${count} accounts written to local/accounts`);
