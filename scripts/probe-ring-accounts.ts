/** Lists the accounts the Rings "register a coin" instruction touches, and adds the ones that exist on devnet to local/clone.json. */
import { getCreateSplInterfaceInstructionAsync } from "@heliuslabs/spr/instructions";
import { address } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync, writeFileSync } from "node:fs";

const connection = new Connection(process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const authority = Keypair.generate().publicKey.toBase58(), mint = Keypair.generate().publicKey.toBase58();
const keys = new Set<string>();
for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
  const ix = await getCreateSplInterfaceInstructionAsync({ authority: address(authority), mint: address(mint), tokenProgram: address(program.toBase58()) });
  console.log("createSplInterface:", ix.accounts?.length, "accounts, data", ix.data?.length, "bytes, program", ix.programAddress);
  for (const meta of ix.accounts ?? []) keys.add(meta.address);
  console.log((ix.accounts ?? []).map((m) => `${m.address.slice(0, 6)}:${m.role}`).join(" "));
}
const list = [...keys].filter((k) => k !== authority && k !== mint);
const infos = await connection.getMultipleAccountsInfo(list.map((k) => new PublicKey(k)));
const plan = JSON.parse(readFileSync("local/clone.json", "utf8"));
const have = new Set([...plan.programs, ...plan.accounts, ...(plan.extra ?? [])]);
const extra = list.filter((k, i) => infos[i] && !infos[i]!.executable && !have.has(k));
plan.extra = [...(plan.extra ?? []), ...extra];
writeFileSync("local/clone.json", `${JSON.stringify(plan, null, 2)}\n`);
console.log("existing on devnet and added:", extra.length, extra.map((k) => k.slice(0, 8)).join(" "));
console.log("not on devnet (made by the instruction):", list.filter((_, i) => !infos[i]).length);
