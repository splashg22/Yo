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
import { connection } from "./solana";

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
  /** Lamports that left the escrow wallet in this transaction, if any. */
  spent: bigint;
  /** The transaction's signatures, in order: the first is the fee payer's. */
  signatures: string[];
  /** True if the escrow wallet itself signed. It signs payouts and sealed-window launches, never a deposit. */
  escrowSigned: boolean;
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
  let spent = 0n;
  accounts.forEach((account, index) => {
    if (account !== owner) return;
    const delta = BigInt(meta.postBalances[index]!) - BigInt(meta.preBalances[index]!);
    if (delta > 0n) receipts.push({ mint: NATIVE, amount: delta });
    else spent += -delta;
  });
  for (const after of meta.postTokenBalances ?? []) {
    if (after.owner !== owner) continue;
    const before = (meta.preTokenBalances ?? []).find((balance) => balance.accountIndex === after.accountIndex);
    const delta = BigInt(after.uiTokenAmount.amount) - BigInt(before?.uiTokenAmount.amount ?? "0");
    if (delta > 0n) receipts.push({ mint: after.mint, amount: delta });
  }
  const signers = accounts.slice(0, transaction.transaction.message.header.numRequiredSignatures);
  return { payer: accounts[0]!, accounts, receipts, spent, signatures: transaction.transaction.signatures, escrowSigned: signers.includes(owner) };
}

export type PayoutOutcome =
  | { status: "landed"; signature: string }
  /** Certain not to land: it was never accepted, or its window has closed. Safe to give the coins back. */
  | { status: "not-sent"; reason: string }
  /** Sent, and the chain cannot be asked right now. The coins must stay debited until it can. */
  | { status: "unknown"; signature: string; lastValidBlockHeight: number };

/** The network fee for a payout: one signature, no priority fee. */
export const PAYOUT_FEE_LAMPORTS = 5_000n;

/**
 * What a payout will cost escrow beyond the amount itself: the network fee, and for a coin sent to a wallet
 * that has never held it, the rent for that wallet's token account. The withdrawing wallet is charged this,
 * so that paying out can never run escrow's own SOL down below what the ledger owes.
 */
export async function payoutCost(destination: string, mint: string): Promise<{ lamports: bigint; opensAccount: boolean }> {
  assertLocalOnly("The mock Ring's escrow");
  if (mint === NATIVE) return { lamports: PAYOUT_FEE_LAMPORTS, opensAccount: false };
  const chain = connection();
  const mintKey = new PublicKey(mint);
  const tokenProgram = await tokenProgramOf(mint);
  const [theirs, ours] = await chain.getMultipleAccountsInfo([
    getAssociatedTokenAddressSync(mintKey, new PublicKey(destination), true, tokenProgram),
    escrowTokenAccount(mintKey, tokenProgram),
  ]);
  if (theirs) return { lamports: PAYOUT_FEE_LAMPORTS, opensAccount: false };
  if (!ours) throw new Error("the Ring holds none of this coin");
  // A token account for this coin is the same size whoever owns it, so escrow's own tells us the rent.
  return { lamports: PAYOUT_FEE_LAMPORTS + BigInt(await chain.getMinimumBalanceForRentExemption(ours.data.length)), opensAccount: true };
}

export interface PreparedPayout {
  signature: string;
  lastValidBlockHeight: number;
  raw: Buffer;
}

/**
 * Builds and signs a payout without sending it. Its signature is known from here on, so it can be put on
 * record before it is sent and looked up afterwards whatever happens in between.
 * The destination's token account is opened only if `opensAccount` says the wallet was charged for it.
 */
export async function preparePayout(destination: string, mint: string, amount: bigint, opensAccount: boolean): Promise<PreparedPayout> {
  assertLocalOnly("The mock Ring's escrow");
  const from = escrow();
  const to = new PublicKey(destination);
  const latest = await connection().getLatestBlockhash();
  const transaction = new Transaction({ feePayer: from.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight });
  if (mint === NATIVE) {
    transaction.add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: amount }));
  } else {
    const mintKey = new PublicKey(mint);
    const tokenProgram = await tokenProgramOf(mint);
    const destinationAccount = getAssociatedTokenAddressSync(mintKey, to, true, tokenProgram);
    if (opensAccount) transaction.add(createAssociatedTokenAccountIdempotentInstruction(from.publicKey, destinationAccount, to, mintKey, tokenProgram));
    transaction.add(
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
  return { signature: bs58.encode(transaction.signature!), lastValidBlockHeight: latest.lastValidBlockHeight, raw: transaction.serialize() };
}

/** True when the node refused the transaction before broadcasting it, or was never reached at all: it cannot land. */
function certainlyNotSent(error: unknown): boolean {
  const text = `${error instanceof Error ? `${error.name} ${error.message}` : String(error)} ${error instanceof Error && error.cause instanceof Error ? error.cause.message : ""}`;
  return /simulation failed|Blockhash not found|ECONNREFUSED|ENOTFOUND/i.test(text);
}

/**
 * Sends a prepared payout and waits for it. Only a refusal before broadcast counts as "not sent". Anything
 * else that goes wrong (a timeout, a bad answer, a dropped connection) may have happened after the node took
 * the transaction, so the outcome is "unknown" and is settled later from the chain.
 */
export async function sendPayout(prepared: PreparedPayout): Promise<PayoutOutcome> {
  try {
    // Preflight simulates first: a payout that would fail is refused here and never sent.
    await connection().sendRawTransaction(prepared.raw);
  } catch (error) {
    if (certainlyNotSent(error)) return { status: "not-sent", reason: error instanceof Error ? error.message.split("\n")[0]! : String(error) };
    return { status: "unknown", signature: prepared.signature, lastValidBlockHeight: prepared.lastValidBlockHeight };
  }
  return payoutStatus(prepared.signature, prepared.lastValidBlockHeight, 40);
}

/** Looks a sent payout up until it lands, its window closes, or the chain stops answering. Never throws: what cannot be learned is "unknown". */
export async function payoutStatus(signature: string, lastValidBlockHeight: number, attempts: number): Promise<PayoutOutcome> {
  const chain = connection();
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      // The height is read first. If it is already past the transaction's last valid block and the chain then
      // has no record of it, it can never land. Read the other way round, it could land between the two reads.
      const height = await chain.getBlockHeight("confirmed");
      const status = (await chain.getSignatureStatus(signature, { searchTransactionHistory: true })).value;
      if (status?.err) return { status: "not-sent", reason: "the payout failed on-chain" };
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return { status: "landed", signature };
      if (!status && height > lastValidBlockHeight) return { status: "not-sent", reason: "the payout expired before it landed" };
    } catch {
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
