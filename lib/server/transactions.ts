/**
 * Builds the transactions a wallet signs, and submits them once signed.
 * The server never holds a user's key: it hands back unsigned bytes.
 */
import {
  type AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { NATIVE } from "../constants";
import { bootstrap } from "./bootstrap";
import { settings } from "./env";
import { depositInstructions } from "./escrow";
import { claimFeesInstructions, claimableFees, launchInstructions, tokenProgramOf, tradeInstructions } from "./pump";
import { connection } from "./solana";
import { state } from "./store";

const MAX_TRANSACTION_BYTES = 1232;

async function compile(payer: PublicKey, instructions: TransactionInstruction[], computeUnits: number): Promise<string> {
  const chain = connection();
  const tables: AddressLookupTableAccount[] = [];
  const table = state().lookupTable;
  if (table) {
    const info = (await chain.getAddressLookupTable(new PublicKey(table))).value;
    if (info) tables.push(info);
  }
  const { blockhash } = await chain.getLatestBlockhash();
  const all = [ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }), ...instructions];
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: all }).compileToV0Message(tables);
  let bytes: Uint8Array;
  try {
    bytes = new VersionedTransaction(message).serialize();
  } catch {
    throw new Error("this does not fit in one transaction");
  }
  if (bytes.length > MAX_TRANSACTION_BYTES) throw new Error("this does not fit in one transaction");
  return Buffer.from(bytes).toString("base64");
}

export interface LaunchRequest {
  wallet: string;
  mint: string;
  name: string;
  symbol: string;
  /** Where the coin's description file can be fetched. Written on-chain by pump.fun. */
  uri: string;
  firstBuyLamports: bigint;
  /** Put the first buy straight into the creator's Ring balance. */
  toRing: boolean;
}

/** A launch: create the coin on the curve, optionally make the first buy, register the coin with the Ring. One signature. */
export async function buildLaunch(request: LaunchRequest): Promise<{ transaction: string; firstBuyTokens: bigint }> {
  if (settings().network === "local") await bootstrap();
  const wallet = new PublicKey(request.wallet);
  const mint = new PublicKey(request.mint);
  const plan = await launchInstructions({
    wallet,
    mint,
    name: request.name,
    symbol: request.symbol,
    uri: request.uri,
    firstBuyLamports: request.firstBuyLamports,
  });
  const instructions = [...plan.instructions];
  if (request.toRing && plan.firstBuyTokens > 0n) instructions.push(...depositInstructions(wallet, request.mint, plan.firstBuyTokens));
  return { transaction: await compile(wallet, instructions, 900_000), firstBuyTokens: plan.firstBuyTokens };
}

export async function buildTrade(request: {
  wallet: string;
  mint: string;
  side: "buy" | "sell";
  amount: bigint;
}): Promise<{ transaction: string; expected: bigint }> {
  const wallet = new PublicKey(request.wallet);
  const plan = await tradeInstructions({ wallet, mint: new PublicKey(request.mint), side: request.side, amount: request.amount, slippagePercent: 2 });
  return { transaction: await compile(wallet, plan.instructions, 600_000), expected: plan.expected };
}

/** A deposit into the Ring: public, with its amount. */
export async function buildDeposit(request: { wallet: string; mint: string; amount: bigint }): Promise<{ transaction: string }> {
  const wallet = new PublicKey(request.wallet);
  const tokenProgram = request.mint === NATIVE ? undefined : await tokenProgramOf(request.mint);
  return { transaction: await compile(wallet, depositInstructions(wallet, request.mint, request.amount, tokenProgram), 120_000) };
}

/** Claims the creator's fees. The claim is public; with `toRing` the SOL lands in the Ring balance in the same transaction. */
export async function buildClaimFees(request: { wallet: string; toRing: boolean }): Promise<{ transaction: string; claimable: bigint }> {
  const wallet = new PublicKey(request.wallet);
  const claimable = await claimableFees(request.wallet);
  if (claimable <= 0n) throw new Error("there are no creator fees to claim yet");
  const instructions = await claimFeesInstructions(wallet);
  if (request.toRing) instructions.push(...depositInstructions(wallet, NATIVE, claimable));
  return { transaction: await compile(wallet, instructions, 600_000), claimable };
}

/** Sends a signed transaction and waits until it is confirmed. Throws one plain sentence if it does not land. */
export async function sendSigned(base64: string): Promise<string> {
  const chain = connection();
  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  } catch {
    throw new Error("that is not a signed transaction");
  }
  // Failures are left as the chain reported them: the operation runner logs the cause and explains it to the caller.
  const signature = await chain.sendRawTransaction(transaction.serialize());
  const latest = await chain.getLatestBlockhash();
  const result = await chain.confirmTransaction(
    { signature, blockhash: transaction.message.recentBlockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  if (result.value.err) throw new Error(`the transaction failed on-chain: ${JSON.stringify(result.value.err)}`);
  return signature;
}
