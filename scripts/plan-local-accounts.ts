/**
 * Works out which accounts the local validator must copy from devnet: builds the real
 * launch and fee-claim instructions, lists every account they touch, and keeps the ones
 * that exist on devnet. Writes local/clone.json. Only needed again if pump.fun or the
 * Rings program change the accounts they use. Needs network.
 */
import type * as PumpSdk from "@pump-fun/pump-sdk";
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
// Graduation and trading in the pool afterwards: the pool program's own settings, the wallets its fees are paid to
// (and their wrapped-SOL accounts, which a pool trade pays into), and everything the instruction that moves a
// sold-out curve into a pool touches.
const { createRequire } = await import("node:module");
const { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
const load = createRequire(import.meta.url);
const pumpSdk = load("@pump-fun/pump-sdk") as typeof PumpSdk;
const swapSdk = load("@pump-fun/pump-sdk/swap") as {
  OnlinePumpAmmSdk: new (c: unknown) => { fetchGlobalConfigAccount(): Promise<{ protocolFeeRecipients: PublicKey[] }> };
  PUMP_AMM_FEE_CONFIG_PDA: PublicKey;
};
const online = new pumpSdk.OnlinePumpSdk(connection());
const global = await online.fetchGlobal();
const migrate = await pumpSdk.PUMP_SDK.migrateInstruction({
  withdrawAuthority: global.withdrawAuthority,
  mint,
  user: wallet,
  tokenProgram: TOKEN_2022_PROGRAM_ID,
});
touched.add(migrate.programId.toBase58());
for (const key of migrate.keys) touched.add(key.pubkey.toBase58());
for (const key of [
  pumpSdk.AMM_GLOBAL_PDA,
  pumpSdk.AMM_GLOBAL_VOLUME_ACCUMULATOR_PDA,
  pumpSdk.GLOBAL_VOLUME_ACCUMULATOR_PDA,
  pumpSdk.PUMP_AMM_EVENT_AUTHORITY_PDA,
  swapSdk.PUMP_AMM_FEE_CONFIG_PDA,
  pumpSdk.PUMP_FEE_CONFIG_PDA,
])
  touched.add(key.toBase58());
const ammConfig = await new swapSdk.OnlinePumpAmmSdk(connection()).fetchGlobalConfigAccount();
for (const recipient of ammConfig.protocolFeeRecipients) {
  if (recipient.equals(PublicKey.default)) continue;
  touched.add(recipient.toBase58());
  touched.add(getAssociatedTokenAddressSync(NATIVE_MINT, recipient, true, TOKEN_PROGRAM_ID).toBase58());
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
// Accounts added by hand stay: they are needed by steps this script does not build.
const { existsSync, readFileSync } = await import("node:fs");
const extra = existsSync("local/clone.json") ? ((JSON.parse(readFileSync("local/clone.json", "utf8")) as { extra?: string[] }).extra ?? []) : [];
writeFileSync("local/clone.json", `${JSON.stringify({ source: "devnet", programs: programs.sort(), accounts: accounts.sort(), extra }, null, 2)}\n`);
console.log(`${programs.length} programs and ${accounts.length} accounts listed in local/clone.json`);
