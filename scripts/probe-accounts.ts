/**
 * Works out which accounts a local validator must copy from devnet for the launch flow:
 * builds the real instructions, lists every account they touch, and keeps the ones that
 * exist on devnet. Writes local/clone.json. Needs network; run once.
 */
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

// The pump SDK only loads as CommonJS: one of its dependencies breaks under ES modules.
const { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount } = createRequire(import.meta.url)("@pump-fun/pump-sdk");

const connection = new Connection(process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const online = new OnlinePumpSdk(connection);
const user = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
const keys = new Set<string>();
const note = (instructions: TransactionInstruction[]) => {
  for (const ix of instructions) { keys.add(ix.programId.toBase58()); for (const k of ix.keys) keys.add(k.pubkey.toBase58()); }
};

const global = await online.fetchGlobal();
console.log("pump global: createV2Enabled", global.createV2Enabled, "feeBps", global.feeBasisPoints.toString(), "creatorFeeBps", global.creatorFeeBasisPoints.toString());
const solAmount = new BN(100_000_000);
const NATIVE = new PublicKey("So11111111111111111111111111111111111111112");
const feeConfig = await online.fetchFeeConfig().catch(() => null);
const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: solAmount, quoteMint: NATIVE });
console.log("0.1 SOL buys", amount.toString(), "base units on a fresh curve");
const base = { global, mint, name: "Probe", symbol: "PRB", uri: "https://example.invalid/p.json", creator: user, user, solAmount, amount };
for (const [label, build] of [
  ["create + buy (SPL Token)", () => PUMP_SDK.createAndBuyInstructions(base)],
  ["create_v2 + buy (Token-2022)", () => PUMP_SDK.createV2AndBuyInstructions({ ...base, mayhemMode: false })],
  ["collect creator fee", () => online.collectCoinCreatorFeeInstructions(user)],
] as const) {
  try {
    const instructions: TransactionInstruction[] = await build();
    note(instructions);
    console.log(label, "->", instructions.length, "instructions:", instructions.map((i) => i.programId.toBase58().slice(0, 6)).join(" "));
  } catch (error) {
    console.log(label, "FAILED:", (error as Error).message.slice(0, 200));
  }
}
// Rings: the programs, the tree and the SOL interface, from the published addresses.
for (const k of ["ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW", "regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ", "777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor", "CiNmas621VuyofiDSrEPfTXHKrdZuB6jMKECyNiMpLXE"]) keys.add(k);

const skip = new Set([user.toBase58(), mint.toBase58()]);
const list = [...keys].filter((k) => !skip.has(k));
const programs: string[] = [], accounts: string[] = [], missing: string[] = [];
for (let i = 0; i < list.length; i += 90) {
  const chunk = list.slice(i, i + 90);
  const infos = await connection.getMultipleAccountsInfo(chunk.map((k) => new PublicKey(k)));
  infos.forEach((info, j) => {
    const key = chunk[j]!;
    if (!info) missing.push(key);
    else if (info.executable && info.owner.toBase58() === "BPFLoaderUpgradeab1e11111111111111111111111") programs.push(key);
    else if (!info.executable) accounts.push(key);
  });
}
writeFileSync("local/clone.json", `${JSON.stringify({ source: "devnet", programs, accounts }, null, 2)}\n`);
console.log(`programs ${programs.length}, accounts ${accounts.length}, not on devnet (made by the transaction) ${missing.length}`);
console.log(programs.join("\n"));
