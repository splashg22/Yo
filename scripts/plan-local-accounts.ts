/**
 * Works out which accounts the local validator must copy from devnet: builds the real
 * launch and fee-claim instructions, lists every account they touch, and keeps the ones
 * that exist on devnet. Writes local/clone.json. Only needed again if pump.fun or the
 * Rings program change the accounts they use. Needs network.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { writeFileSync } from "node:fs";

process.env.RING_NETWORK = "devnet";
process.env.LOCAL_RPC_URL = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const { claimFeesInstructions, launchInstructions } = await import("../lib/server/pump");
const { connection } = await import("../lib/server/solana");

const RINGS = [
  "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW",
  "regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ",
  "777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor",
  "CiNmas621VuyofiDSrEPfTXHKrdZuB6jMKECyNiMpLXE",
];
const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
/** Programs every validator already has. */
const BUILT_IN = new Set(["11111111111111111111111111111111", "ComputeBudget111111111111111111111111111111", "SysvarRent111111111111111111111111111111111"]);

const wallet = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const launch = await launchInstructions({ wallet, mint, name: "sample", symbol: "SAMPLE", uri: "", firstBuyLamports: 100_000_000n });
const instructions = [...launch.instructions, ...(await claimFeesInstructions(wallet))];
const touched = new Set<string>(RINGS);
for (const instruction of instructions) {
  touched.add(instruction.programId.toBase58());
  for (const key of instruction.keys) touched.add(key.pubkey.toBase58());
}
touched.delete(wallet.toBase58());
touched.delete(mint.toBase58());

const candidates = [...touched].filter((key) => !BUILT_IN.has(key));
const infos = await connection().getMultipleAccountsInfo(candidates.map((key) => new PublicKey(key)));
const programs: string[] = [];
const accounts: string[] = [];
candidates.forEach((key, index) => {
  const info = infos[index];
  if (!info) return; // made by the transaction itself
  if (info.executable && info.owner.toBase58() === UPGRADEABLE_LOADER) programs.push(key);
  else if (!info.executable) accounts.push(key);
});
writeFileSync("local/clone.json", `${JSON.stringify({ source: "devnet", programs: programs.sort(), accounts: accounts.sort() }, null, 2)}\n`);
console.log(`${programs.length} programs and ${accounts.length} accounts listed in local/clone.json`);
