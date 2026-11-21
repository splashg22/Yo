/**
 * Everything that touches the chain from the server: building transactions for the wallet
 * to sign (the server never holds a user's key), reading the curve, and the mock Ring's
 * escrow on a local validator.
 *
 * The pump.fun calls here are the real program, through its own SDK. The "register with
 * the Ring" instruction is the real Privacy Rings program too.
 */
import { getCreateSplInterfaceInstructionAsync } from "@heliuslabs/spr/instructions";
import { address, type Instruction } from "@solana/kit";
import {
  TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  AddressLookupTableAccount, AddressLookupTableProgram, ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL,
  PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { NATIVE, assertLocalOnly, settings } from "./env";
import { save, state } from "./store";

// The pump SDK only loads as CommonJS: one of its dependencies breaks under ES modules.
const pump = createRequire(import.meta.url)("@pump-fun/pump-sdk") as typeof import("@pump-fun/pump-sdk");
const { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount, bondingCurveMarketCap, bondingCurvePda } = pump;

export const DECIMALS = 6; // every pump.fun coin
const NATIVE_KEY = new PublicKey(NATIVE);

let cached: { url: string; connection: Connection } | undefined;
export function connection(): Connection {
  const url = settings().rpcUrl;
  if (cached?.url !== url) cached = { url, connection: new Connection(url, "confirmed") };
  return cached.connection;
}

/** A key the server keeps on disk. Local validator only. */
function localKey(name: string): Keypair {
  assertLocalOnly(`The ${name} key`);
  const dir = settings().dataDir, path = join(dir, `${name}.json`);
  if (existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
  const key = Keypair.generate();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify([...key.secretKey]), { mode: 0o600 });
  return key;
}
/** Holds the coins deposited into the mock Ring. */
export const escrow = () => localKey("mock-ring-escrow");
/** Pays for one-off set-up on the local chain (the lookup table). */
const ops = () => localKey("local-ops");

const toWeb3 = (ix: Instruction) => new TransactionInstruction({
  programId: new PublicKey(ix.programAddress),
  keys: (ix.accounts ?? []).map((m) => ({ pubkey: new PublicKey(m.address), isSigner: m.role >= 2, isWritable: m.role === 1 || m.role === 3 })),
  data: Buffer.from(ix.data ?? []),
});

async function airdrop(to: PublicKey, sol: number): Promise<void> {
  assertLocalOnly("The faucet");
  await connection().confirmTransaction(await connection().requestAirdrop(to, sol * LAMPORTS_PER_SOL), "confirmed");
}
export const faucet = (wallet: string) => airdrop(new PublicKey(wallet), 10);

async function pumpState() {
  const online = new OnlinePumpSdk(connection());
  const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig().catch(() => null)]);
  return { online, global, feeConfig };
}

/** The instructions of a launch, shared by the builder and by the lookup-table set-up. */
async function launchInstructions(input: { wallet: PublicKey; mint: PublicKey; name: string; symbol: string; uri: string; firstBuyLamports: bigint; toRing: boolean }) {
  const { global, feeConfig } = await pumpState();
  const common = { mint: input.mint, name: input.name, symbol: input.symbol, uri: input.uri, creator: input.wallet, user: input.wallet, mayhemMode: false };
  const instructions: TransactionInstruction[] = [];
  let bought = 0n;
  if (input.firstBuyLamports > 0n) {
    const solAmount = new BN(input.firstBuyLamports.toString());
    const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: solAmount, quoteMint: NATIVE_KEY });
    bought = BigInt(amount.toString());
    instructions.push(...(await PUMP_SDK.createV2AndBuyInstructions({ ...common, global, solAmount, amount })));
  } else {
    instructions.push(await PUMP_SDK.createV2Instruction(common));
  }
  // Register the coin with the Ring: the real Privacy Rings instruction.
  instructions.push(toWeb3(await getCreateSplInterfaceInstructionAsync({
    authority: address(input.wallet.toBase58()), mint: address(input.mint.toBase58()), tokenProgram: address(TOKEN_2022_PROGRAM_ID.toBase58()),
  })));
  if (input.toRing && bought > 0n) instructions.push(...depositInstructions(input.wallet, input.mint.toBase58(), bought, TOKEN_2022_PROGRAM_ID));
  return { instructions, bought };
}

/** Moves coins from a wallet into the mock Ring's escrow. On a real Ring this is the Ring's own deposit instruction. */
function depositInstructions(wallet: PublicKey, mint: string, amount: bigint, tokenProgram: PublicKey): TransactionInstruction[] {
  const to = escrow().publicKey;
  if (mint === NATIVE) return [SystemProgram.transfer({ fromPubkey: wallet, toPubkey: to, lamports: amount })];
  const mintKey = new PublicKey(mint);
  const source = getAssociatedTokenAddressSync(mintKey, wallet, false, tokenProgram);
  const destination = getAssociatedTokenAddressSync(mintKey, to, false, tokenProgram);
  return [
    createAssociatedTokenAccountIdempotentInstruction(wallet, destination, to, mintKey, tokenProgram),
    createTransferCheckedInstruction(source, mintKey, destination, wallet, amount, DECIMALS, [], tokenProgram),
  ];
}

/**
 * One-off set-up of a fresh local chain: pump's fee wallets are empty there and cannot
 * receive a fee smaller than the rent minimum, and a launch with a first buy only fits in
 * one transaction through a lookup table of the accounts every launch shares.
 */
export async function bootstrap(): Promise<void> {
  assertLocalOnly("Local set-up");
  const s = state();
  const c = connection();
  if (s.lookupTable && (await c.getAccountInfo(new PublicKey(s.lookupTable)))) return;
  const { global, feeConfig } = await pumpState();
  const recipients = new Set<string>();
  const collect = (value: unknown, key = ""): void => {
    if (value instanceof PublicKey) { if (/recipient/i.test(key) && !value.equals(PublicKey.default)) recipients.add(value.toBase58()); }
    else if (Array.isArray(value)) value.forEach((v) => collect(v, key));
    else if (value && typeof value === "object" && !BN.isBN(value)) for (const [k, v] of Object.entries(value)) collect(v, k);
  };
  collect(global); collect(feeConfig);
  for (const recipient of recipients) {
    const key = new PublicKey(recipient);
    if ((await c.getBalance(key)) < LAMPORTS_PER_SOL / 100) await airdrop(key, 1);
  }
  const payer = ops();
  if ((await c.getBalance(payer.publicKey)) < LAMPORTS_PER_SOL) await airdrop(payer.publicKey, 5);
  if ((await c.getBalance(escrow().publicKey)) < LAMPORTS_PER_SOL / 10) await airdrop(escrow().publicKey, 1);

  const sample = { wallet: Keypair.generate().publicKey, mint: Keypair.generate().publicKey };
  const { instructions } = await launchInstructions({ ...sample, name: "x", symbol: "x", uri: "x", firstBuyLamports: 1_000_000n, toRing: true });
  const skip = new Set([sample.wallet.toBase58(), sample.mint.toBase58()]);
  const shared = [...new Set(instructions.flatMap((ix) => [ix.programId, ...ix.keys.map((k) => k.pubkey)]).map((k) => k.toBase58()))]
    .filter((k) => !skip.has(k)).map((k) => new PublicKey(k));
  const [create, table] = AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot: await c.getSlot("finalized") });
  await sendAndConfirmTransaction(c, new Transaction().add(create), [payer]);
  for (let i = 0; i < shared.length; i += 20) {
    await sendAndConfirmTransaction(c, new Transaction().add(AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: payer.publicKey, payer: payer.publicKey, addresses: shared.slice(i, i + 20) })), [payer]);
  }
  // A lookup table can be used one slot after it was last extended.
  for (let i = 0; i < 20; i++) {
    const info = (await c.getAddressLookupTable(table)).value;
    if (info && info.state.addresses.length === shared.length && (await c.getSlot()) > info.state.lastExtendedSlot + 1) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  s.lookupTable = table.toBase58();
  save();
}

async function compile(payer: PublicKey, instructions: TransactionInstruction[], units = 600_000): Promise<string> {
  const c = connection();
  const tables: AddressLookupTableAccount[] = [];
  const table = state().lookupTable;
  if (table) { const info = (await c.getAddressLookupTable(new PublicKey(table))).value; if (info) tables.push(info); }
  const { blockhash } = await c.getLatestBlockhash();
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ...instructions] }).compileToV0Message(tables);
  const bytes = new VersionedTransaction(message).serialize();
  if (bytes.length > 1232) throw new Error("this does not fit in one transaction");
  return Buffer.from(bytes).toString("base64");
}

/** A launch: create the coin on the curve, optionally make the first buy, register the coin with the Ring. One signature. */
export async function buildLaunch(input: { wallet: string; mint: string; name: string; symbol: string; uri?: string; firstBuyLamports?: bigint; toRing?: boolean }) {
  const name = input.name.trim(), symbol = input.symbol.trim();
  if (name.length < 1 || name.length > 32) throw new Error("the name must be 1 to 32 characters");
  if (!/^[A-Za-z0-9]{1,10}$/.test(symbol)) throw new Error("the ticker must be 1 to 10 letters or digits");
  const firstBuyLamports = input.firstBuyLamports ?? 0n;
  if (firstBuyLamports < 0n) throw new Error("the first buy cannot be negative");
  if (settings().network === "local") await bootstrap();
  const { instructions, bought } = await launchInstructions({
    wallet: new PublicKey(input.wallet), mint: new PublicKey(input.mint), name, symbol,
    uri: input.uri?.trim() || "", firstBuyLamports, toRing: Boolean(input.toRing),
  });
  return { transaction: await compile(new PublicKey(input.wallet), instructions, 900_000), firstBuyTokens: bought.toString(), signers: ["wallet", "mint"] };
}

async function tokenProgramOf(mint: string): Promise<PublicKey> {
  const info = await connection().getAccountInfo(new PublicKey(mint));
  if (!info) throw new Error("that coin does not exist on this chain");
  return info.owner;
}

/** A public buy or sell on the curve. */
export async function buildTrade(input: { wallet: string; mint: string; side: "buy" | "sell"; amount: bigint; slippagePercent?: number }) {
  if (input.amount <= 0n) throw new Error("the amount must be above zero");
  const wallet = new PublicKey(input.wallet), mint = new PublicKey(input.mint);
  const { online, global, feeConfig } = await pumpState();
  const tokenProgram = await tokenProgramOf(input.mint);
  const slippage = input.slippagePercent ?? 2;
  let instructions: TransactionInstruction[];
  let expected: bigint;
  if (input.side === "buy") {
    const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } = await online.fetchBuyState(mint, wallet, tokenProgram);
    const solAmount = new BN(input.amount.toString());
    const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: bondingCurve.tokenTotalSupply, bondingCurve, amount: solAmount, quoteMint: NATIVE_KEY });
    expected = BigInt(amount.toString());
    instructions = await PUMP_SDK.buyInstructions({ global, bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo, mint, user: wallet, amount, solAmount, slippage, tokenProgram });
  } else {
    const { bondingCurveAccountInfo, bondingCurve } = await online.fetchSellState(mint, wallet, tokenProgram);
    const amount = new BN(input.amount.toString());
    const solAmount = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply: bondingCurve.tokenTotalSupply, bondingCurve, amount });
    expected = BigInt(solAmount.toString());
    instructions = await PUMP_SDK.sellInstructions({ global, bondingCurveAccountInfo, bondingCurve, mint, user: wallet, amount, solAmount, slippage, tokenProgram, mayhemMode: false });
  }
  return { transaction: await compile(wallet, instructions), expected: expected.toString() };
}

/** A deposit into the Ring: public, with its amount. */
export async function buildDeposit(input: { wallet: string; mint: string; amount: bigint }) {
  if (input.amount <= 0n) throw new Error("the amount must be above zero");
  const tokenProgram = input.mint === NATIVE ? TOKEN_2022_PROGRAM_ID : await tokenProgramOf(input.mint);
  return { transaction: await compile(new PublicKey(input.wallet), depositInstructions(new PublicKey(input.wallet), input.mint, input.amount, tokenProgram), 120_000) };
}

/** Claims the creator's fees. The claim is public; with `toRing` the SOL lands in the Ring balance in the same transaction. */
export async function buildClaimFees(input: { wallet: string; toRing?: boolean }) {
  const wallet = new PublicKey(input.wallet);
  const { online } = await pumpState();
  const claimable = BigInt((await online.getCreatorVaultBalance(wallet)).toString());
  if (claimable <= 0n) throw new Error("there are no creator fees to claim yet");
  const instructions = await online.collectCoinCreatorFeeInstructions(wallet);
  if (input.toRing) instructions.push(...depositInstructions(wallet, NATIVE, claimable, TOKEN_2022_PROGRAM_ID));
  return { transaction: await compile(wallet, instructions), claimable: claimable.toString() };
}
export async function claimableFees(wallet: string): Promise<bigint> {
  const { online } = await pumpState();
  return BigInt((await online.getCreatorVaultBalance(new PublicKey(wallet))).toString());
}

/**
 * Reads a confirmed transaction and returns what it paid into the mock Ring's escrow and
 * who paid it. The Ring ledger is credited from this, never from what a client claims.
 */
export async function escrowReceipts(signature: string): Promise<{ payer: string; receipts: { mint: string; amount: bigint }[] }> {
  const tx = await connection().getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx || !tx.meta) throw new Error("that transaction is not confirmed on this chain");
  if (tx.meta.err) throw new Error("that transaction failed");
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
  const owner = escrow().publicKey.toBase58();
  const receipts: { mint: string; amount: bigint }[] = [];
  for (let i = 0; i < keys.length; i++) {
    if (keys.get(i)!.toBase58() !== owner) continue;
    const delta = BigInt(tx.meta.postBalances[i]!) - BigInt(tx.meta.preBalances[i]!);
    if (delta > 0n) receipts.push({ mint: NATIVE, amount: delta });
  }
  for (const post of tx.meta.postTokenBalances ?? []) {
    if (post.owner !== owner) continue;
    const pre = (tx.meta.preTokenBalances ?? []).find((b) => b.accountIndex === post.accountIndex);
    const delta = BigInt(post.uiTokenAmount.amount) - BigInt(pre?.uiTokenAmount.amount ?? "0");
    if (delta > 0n) receipts.push({ mint: post.mint, amount: delta });
  }
  return { payer: keys.get(0)!.toBase58(), receipts };
}

/** Pays a withdrawal out of escrow to a public wallet. */
export async function payFromEscrow(destination: string, mint: string, amount: bigint): Promise<string> {
  assertLocalOnly("The mock Ring's escrow");
  const from = escrow(), to = new PublicKey(destination);
  const tx = new Transaction();
  if (mint === NATIVE) tx.add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: amount }));
  else {
    const mintKey = new PublicKey(mint), tokenProgram = await tokenProgramOf(mint);
    const destinationAccount = getAssociatedTokenAddressSync(mintKey, to, true, tokenProgram);
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(from.publicKey, destinationAccount, to, mintKey, tokenProgram),
      createTransferCheckedInstruction(getAssociatedTokenAddressSync(mintKey, from.publicKey, false, tokenProgram), mintKey, destinationAccount, from.publicKey, amount, DECIMALS, [], tokenProgram),
    );
  }
  return sendAndConfirmTransaction(connection(), tx, [from], { commitment: "confirmed" });
}

export async function publicBalance(wallet: string, mint: string): Promise<bigint> {
  const owner = new PublicKey(wallet);
  if (mint === NATIVE) return BigInt(await connection().getBalance(owner));
  const tokenProgram = await tokenProgramOf(mint);
  const account = await connection().getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(mint), owner, true, tokenProgram)).catch(() => null);
  return BigInt(account?.value.amount ?? "0");
}

/** The curve's public state for one coin. */
export async function curveOf(mint: string) {
  const { online } = await pumpState();
  const curve = await online.fetchBondingCurve(new PublicKey(mint));
  const supply = BigInt(curve.tokenTotalSupply.toString());
  const marketCap = bondingCurveMarketCap({ mintSupply: curve.tokenTotalSupply, virtualQuoteReserves: curve.virtualQuoteReserves, virtualTokenReserves: curve.virtualTokenReserves });
  return {
    supply,
    marketCapLamports: BigInt(marketCap.toString()),
    /** Lamports for one million base units (one whole coin). */
    priceLamports: Number(curve.virtualQuoteReserves.toString()) / Number(curve.virtualTokenReserves.toString()) * 10 ** DECIMALS,
    complete: curve.complete,
    creator: curve.creator.toBase58(),
  };
}
export async function coinExists(mint: string): Promise<boolean> {
  return Boolean(await connection().getAccountInfo(bondingCurvePda(new PublicKey(mint))));
}

/** Sends a signed transaction and waits until it is confirmed. */
export async function sendSigned(base64: string): Promise<string> {
  const c = connection();
  let signature: string;
  try {
    signature = await c.sendRawTransaction(Buffer.from(base64, "base64"));
  } catch (error) {
    const logs = (error as { logs?: string[] }).logs ?? [];
    const reason = logs.map((l) => /Error Message: (.+?)\.?$/.exec(l)?.[1]).find(Boolean);
    throw new Error(reason ? `the chain refused it: ${reason}` : (error as Error).message.split("\n")[0]);
  }
  const result = await c.confirmTransaction(signature, "confirmed");
  if (result.value.err) throw new Error("the transaction failed on-chain");
  return signature;
}
