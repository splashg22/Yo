/**
 * MOCK. The escrow wallet behind the local Ring stand-in: where deposited coins sit on the
 * local chain, how deposits are read back from confirmed transactions, and how
 * withdrawals are paid out. The real Ring needs none of this: its program holds the coins.
 */
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COIN_DECIMALS, NATIVE } from "../constants";
import { assertLocalOnly, settings } from "./env";
import { tokenProgramOf } from "./pump";
import { connection, isUnreachable } from "./solana";

/** A key the server keeps on disk. Local validator only. */
export function localKey(name: string): Keypair {
  assertLocalOnly(`The ${name} key`);
  const directory = settings().dataDir;
  const path = join(directory, `${name}.json`);
  if (existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
  const key = Keypair.generate();
  mkdirSync(directory, { recursive: true });
  writeFileSync(path, JSON.stringify([...key.secretKey]), { mode: 0o600 });
  return key;
}
export const escrow = (): Keypair => localKey("mock-ring-escrow");

const escrowTokenAccount = (mint: PublicKey, tokenProgram: PublicKey): PublicKey =>
  getAssociatedTokenAddressSync(mint, escrow().publicKey, false, tokenProgram);

/** Moves coins from a wallet into escrow. On the real Ring this is the Ring's own deposit instruction. */
export function depositInstructions(
  wallet: PublicKey,
  mint: string,
  amount: bigint,
  tokenProgram: PublicKey = TOKEN_2022_PROGRAM_ID,
): TransactionInstruction[] {
  const to = escrow().publicKey;
  if (mint === NATIVE) return [SystemProgram.transfer({ fromPubkey: wallet, toPubkey: to, lamports: amount })];
  const mintKey = new PublicKey(mint);
  const destination = escrowTokenAccount(mintKey, tokenProgram);
  return [
    createAssociatedTokenAccountIdempotentInstruction(wallet, destination, to, mintKey, tokenProgram),
    createTransferCheckedInstruction(
      getAssociatedTokenAddressSync(mintKey, wallet, false, tokenProgram),
      mintKey,
      destination,
      wallet,
      amount,
      COIN_DECIMALS,
      [],
      tokenProgram,
    ),
  ];
}

export interface Receipts {
  /** Who paid for the transaction. Deposits are credited to this wallet and to no one else. */
  payer: string;
  /** Every account the transaction touched. */
  accounts: string[];
  receipts: { mint: string; amount: bigint }[];
}

/**
 * Reads a confirmed transaction back from the chain and returns what it paid into escrow.
 * The Ring ledger is credited from this, never from what a client says it sent.
 */
export async function escrowReceipts(signature: string): Promise<Receipts> {
  const transaction = await connection().getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!transaction?.meta) throw new Error("that transaction is not confirmed on this chain");
  if (transaction.meta.err) throw new Error("that transaction failed on-chain");
  const { meta } = transaction;
  const keys = transaction.transaction.message.getAccountKeys({ accountKeysFromLookups: meta.loadedAddresses });
  const accounts = Array.from({ length: keys.length }, (_, index) => keys.get(index)!.toBase58());
  const owner = escrow().publicKey.toBase58();
  const receipts: Receipts["receipts"] = [];
  accounts.forEach((account, index) => {
    if (account !== owner) return;
    const delta = BigInt(meta.postBalances[index]!) - BigInt(meta.preBalances[index]!);
    if (delta > 0n) receipts.push({ mint: NATIVE, amount: delta });
  });
  for (const after of meta.postTokenBalances ?? []) {
    if (after.owner !== owner) continue;
    const before = (meta.preTokenBalances ?? []).find((balance) => balance.accountIndex === after.accountIndex);
    const delta = BigInt(after.uiTokenAmount.amount) - BigInt(before?.uiTokenAmount.amount ?? "0");
    if (delta > 0n) receipts.push({ mint: after.mint, amount: delta });
  }
  return { payer: accounts[0]!, accounts, receipts };
}

export type PayoutOutcome =
  | { status: "landed"; signature: string }
  /** Certain not to land: it was never accepted, or its window has closed. Safe to give the coins back. */
  | { status: "not-sent"; reason: string }
  /** Sent, and the chain cannot be asked right now. The coins must stay debited until it can. */
  | { status: "unknown"; signature: string; lastValidBlockHeight: number };

/**
 * Pays a withdrawal out of escrow. The signature is known before anything is sent, so an
 * uncertain outcome can be looked up later instead of being guessed at.
 */
export async function payFromEscrow(destination: string, mint: string, amount: bigint): Promise<PayoutOutcome> {
  assertLocalOnly("The mock Ring's escrow");
  const from = escrow();
  const to = new PublicKey(destination);
  const chain = connection();
  let transaction: Transaction;
  let lastValidBlockHeight: number;
  try {
    const latest = await chain.getLatestBlockhash();
    lastValidBlockHeight = latest.lastValidBlockHeight;
    transaction = new Transaction({ feePayer: from.publicKey, blockhash: latest.blockhash, lastValidBlockHeight });
    if (mint === NATIVE) {
      transaction.add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: amount }));
    } else {
      const mintKey = new PublicKey(mint);
      const tokenProgram = await tokenProgramOf(mint);
      const destinationAccount = getAssociatedTokenAddressSync(mintKey, to, true, tokenProgram);
      transaction.add(
        createAssociatedTokenAccountIdempotentInstruction(from.publicKey, destinationAccount, to, mintKey, tokenProgram),
        createTransferCheckedInstruction(
          escrowTokenAccount(mintKey, tokenProgram),
          mintKey,
          destinationAccount,
          from.publicKey,
          amount,
          COIN_DECIMALS,
          [],
          tokenProgram,
        ),
      );
    }
    transaction.sign(from);
  } catch (error) {
    return { status: "not-sent", reason: isUnreachable(error) ? "the chain is not answering" : error instanceof Error ? error.message : String(error) };
  }
  const signature = bs58.encode(transaction.signature!);
  try {
    // Preflight simulates first: a payout that would fail is refused here and never sent.
    await chain.sendRawTransaction(transaction.serialize());
  } catch (error) {
    if (isUnreachable(error)) return { status: "unknown", signature, lastValidBlockHeight };
    return { status: "not-sent", reason: error instanceof Error ? error.message.split("\n")[0]! : String(error) };
  }
  return payoutStatus(signature, lastValidBlockHeight, 40);
}

/** Looks a sent payout up until it lands, its window closes, or the chain stops answering. */
export async function payoutStatus(signature: string, lastValidBlockHeight: number, attempts: number): Promise<PayoutOutcome> {
  const chain = connection();
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const status = (await chain.getSignatureStatus(signature, { searchTransactionHistory: true })).value;
      if (status?.err) return { status: "not-sent", reason: "the payout failed on-chain" };
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return { status: "landed", signature };
      if (!status && (await chain.getBlockHeight("confirmed")) > lastValidBlockHeight)
        return { status: "not-sent", reason: "the payout expired before it landed" };
    } catch (error) {
      if (!isUnreachable(error)) throw error;
      return { status: "unknown", signature, lastValidBlockHeight };
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { status: "unknown", signature, lastValidBlockHeight };
}

/** What escrow actually holds on-chain, for the solvency check. */
export async function escrowBalance(mint: string): Promise<bigint> {
  const owner = escrow().publicKey;
  if (mint === NATIVE) return BigInt(await connection().getBalance(owner));
  const tokenProgram = await tokenProgramOf(mint);
  const info = await connection()
    .getTokenAccountBalance(escrowTokenAccount(new PublicKey(mint), tokenProgram))
    .catch((error: unknown) => {
      if (/could not find account|Invalid param/i.test(String(error))) return null; // no deposits of this coin yet
      throw error;
    });
  return BigInt(info?.value.amount ?? "0");
}
