/**
 * Proof on the local validator: can one transaction create a pump.fun coin AND register
 * it with the Ring, with and without a first buy, for both kinds of coin?
 * Run with the local validator up: npx tsx scripts/probe-launch.ts
 */
import { getCreateSplInterfaceInstructionAsync } from "@heliuslabs/spr/instructions";
import { address, type Instruction } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  AddressLookupTableAccount, AddressLookupTableProgram, ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL,
  PublicKey, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { createRequire } from "node:module";
const { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount } = createRequire(import.meta.url)("@pump-fun/pump-sdk");

const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const user = Keypair.generate();
await connection.confirmTransaction(await connection.requestAirdrop(user.publicKey, 50 * LAMPORTS_PER_SOL));
const online = new OnlinePumpSdk(connection);
const global = await online.fetchGlobal();
const feeConfig = await online.fetchFeeConfig().catch(() => null);
// On a fresh local chain pump's fee wallets are empty, and a fee smaller than the rent
// minimum cannot be paid into an empty wallet. Fund them once.
const recipients = new Set<string>();
const collect = (value: unknown, key = "") => {
  if (value instanceof PublicKey) { if (/recipient/i.test(key) && !value.equals(PublicKey.default)) recipients.add(value.toBase58()); }
  else if (Array.isArray(value)) value.forEach((v) => collect(v, key));
  else if (value && typeof value === "object" && !(value instanceof BN)) for (const [k, v] of Object.entries(value)) collect(v, k);
};
collect(global); collect(feeConfig);
for (const r of recipients) await connection.confirmTransaction(await connection.requestAirdrop(new PublicKey(r), LAMPORTS_PER_SOL));
console.log("funded", recipients.size, "fee wallets");
const NATIVE = new PublicKey("So11111111111111111111111111111111111111112");
const toWeb3 = (ix: Instruction) => new TransactionInstruction({
  programId: new PublicKey(ix.programAddress),
  keys: (ix.accounts ?? []).map((m) => ({ pubkey: new PublicKey(m.address), isSigner: m.role >= 2, isWritable: m.role === 1 || m.role === 3 })),
  data: Buffer.from(ix.data ?? []),
});

async function attempt(label: string, instructions: TransactionInstruction[], signers: Keypair[], lookup?: AddressLookupTableAccount) {
  const all = [ComputeBudgetProgram.setComputeUnitLimit({ units: 900_000 }), ...instructions];
  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: user.publicKey, recentBlockhash: blockhash, instructions: all }).compileToV0Message(lookup ? [lookup] : []));
  let size = 0;
  try { size = tx.serialize().length; } catch { console.log(`FAIL ${label}: does not fit in one transaction`); return false; }
  if (size > 1232) { console.log(`FAIL ${label}: ${size} bytes, over the 1232 limit`); return false; }
  tx.sign(signers);
  const sim = await connection.simulateTransaction(tx, { sigVerify: false });
  if (sim.value.err) {
    console.log(`FAIL ${label} (${size} bytes): ${JSON.stringify(sim.value.err)}`);
    for (const line of (sim.value.logs ?? []).filter((l) => /rror|failed|invalid|nsupported|denied/.test(l)).slice(-4)) console.log("     ", line.slice(0, 200));
    return false;
  }
  await connection.confirmTransaction(await connection.sendTransaction(tx), "confirmed");
  console.log(`OK   ${label}. ${size} bytes, ${sim.value.unitsConsumed} compute units`);
  return true;
}

for (const v2 of [false, true]) {
  const kind = v2 ? "Token-2022 coin (create_v2)" : "SPL Token coin (create)";
  const tokenProgram = address((v2 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID).toBase58());
  const build = async () => {
    const mint = Keypair.generate();
    const solAmount = new BN(0.5 * LAMPORTS_PER_SOL);
    const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: solAmount, quoteMint: NATIVE });
    const common = { mint: mint.publicKey, name: "Probe Coin", symbol: "PROBE", uri: "https://example.invalid/probe.json", creator: user.publicKey, user: user.publicKey };
    const create: TransactionInstruction = v2 ? await PUMP_SDK.createV2Instruction({ ...common, mayhemMode: false }) : await PUMP_SDK.createInstruction(common);
    const withBuy: TransactionInstruction[] = v2
      ? await PUMP_SDK.createV2AndBuyInstructions({ ...common, global, solAmount, amount, mayhemMode: false })
      : await PUMP_SDK.createAndBuyInstructions({ ...common, global, solAmount, amount });
    const register = toWeb3(await getCreateSplInterfaceInstructionAsync({ authority: address(user.publicKey.toBase58()), mint: address(mint.publicKey.toBase58()), tokenProgram }));
    return { mint, create, withBuy, register };
  };

  let a = await build();
  await attempt(`${kind}: create only`, [a.create], [user, a.mint]);
  a = await build();
  await attempt(`${kind}: create + register with Ring`, [a.create, a.register], [user, a.mint]);
  a = await build();
  await attempt(`${kind}: create + first buy`, a.withBuy, [user, a.mint]);

  // With a first buy as well the transaction is too long, unless the accounts every launch
  // shares are put in a lookup table once.
  a = await build();
  const shared = [...new Set([...a.withBuy, a.register].flatMap((ix) => [ix.programId, ...ix.keys.filter((k) => !k.isSigner).map((k) => k.pubkey)]).map((k) => k.toBase58()))]
    .filter((k) => k !== a.mint.publicKey.toBase58()).map((k) => new PublicKey(k));
  const [createTable, table] = AddressLookupTableProgram.createLookupTable({ authority: user.publicKey, payer: user.publicKey, recentSlot: await connection.getSlot("finalized") });
  await sendAndConfirmTransaction(connection, new Transaction().add(createTable, AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: user.publicKey, payer: user.publicKey, addresses: shared.slice(0, 20) })), [user]);
  if (shared.length > 20) await sendAndConfirmTransaction(connection, new Transaction().add(AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: user.publicKey, payer: user.publicKey, addresses: shared.slice(20) })), [user]);
  await new Promise((r) => setTimeout(r, 2000));
  const lookup = (await connection.getAddressLookupTable(table)).value!;
  await attempt(`${kind}: create + first buy + register with Ring (lookup table)`, [...a.withBuy, a.register], [user, a.mint], lookup);
}
