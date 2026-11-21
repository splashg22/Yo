/**
 * Builds the transactions a wallet signs, and submits them once signed.
 * The server never holds a user's key: it hands back unsigned bytes.
 */
import bs58 from "bs58";
import {
  type AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { NATIVE } from "../constants";
import { bootstrap } from "./bootstrap";
import { assertLocalOnly, assertRing, ringAvailable, settings } from "./env";
import { depositInstructions, escrow } from "./escrow";
import { claimFeesInstructions, claimableFees, graduateInstructions, launchInstructions, tokenProgramOf, tradeInstructions } from "./pump";
import { state } from "./store";
import { lookupTable, recentBlockhash } from "./warm";
import { RENT_RESERVE_LAMPORTS } from "./windows";

const MAX_TRANSACTION_BYTES = 1232;

interface Compiled {
  message: VersionedTransaction;
  lastValidBlockHeight: number;
}
/** What a caller may ask of any transaction built here. */
export interface SendOptions {
  /** Paid to the validator for a place in the block, in lamports for the whole transaction. */
  priorityLamports?: bigint;
  /** Paid to Jito's block builders, in lamports. Ignored unless a tip account is configured. */
  tipLamports?: bigint;
}

/**
 * Transactions this server built and is willing to send, by the hash of their message. `tx/send` refuses
 * anything else, so the server is not a relay for whatever anyone hands it. Kept until the blockhash has
 * certainly expired; a restart forgets them, and the person builds again.
 */
const built = new Map<string, { until: number; lastValidBlockHeight: number; kind: string }>();
const BUILT_KEPT_MS = 180_000;
const digest = (message: Uint8Array): string => createHash("sha256").update(message).digest("base64");
function remember(transaction: VersionedTransaction, lastValidBlockHeight: number, kind: string): void {
  const now = Date.now();
  if (built.size > 50_000) for (const [key, entry] of built) if (entry.until < now) built.delete(key);
  built.set(digest(transaction.message.serialize()), { until: now + BUILT_KEPT_MS, lastValidBlockHeight, kind });
}
/** What is on record for a signed transaction, if this server built it and it has not expired. */
export function builtHere(transaction: VersionedTransaction): { lastValidBlockHeight: number; kind: string } | undefined {
  const entry = built.get(digest(transaction.message.serialize()));
  return entry && entry.until > Date.now() ? entry : undefined;
}

/** Builds the unsigned transaction and checks it fits. Reads nothing from the chain when the warm cache is fresh. */
async function compileMessage(
  payer: PublicKey,
  instructions: TransactionInstruction[],
  computeUnits: number,
  kind: string,
  options: SendOptions = {},
): Promise<Compiled> {
  const tables: AddressLookupTableAccount[] = [];
  const table = state().lookupTable;
  if (table) {
    const info = await lookupTable(table);
    if (info) tables.push(info);
  }
  const { blockhash, lastValidBlockHeight } = await recentBlockhash();
  // Two builds of the same action inside one blockhash would otherwise be the same bytes, and the chain takes a
  // transaction only once: the second press of a button would silently do nothing. A different compute limit
  // (which costs nothing unless it is used) makes each build its own transaction.
  unique = (unique + 1) % 1_000;
  const all = [ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits + unique })];
  const priority = options.priorityLamports ?? 0n;
  if (priority < 0n || priority > MAX_PRIORITY_LAMPORTS) throw new Error("the priority fee is out of range");
  // The chain takes the fee as a price per unit of compute; the caller names the total they are willing to pay.
  if (priority > 0n) all.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: (priority * 1_000_000n) / BigInt(computeUnits) }));
  all.push(...instructions);
  const tip = options.tipLamports ?? 0n;
  const { jitoTipAccount } = settings();
  if (tip < 0n || tip > MAX_PRIORITY_LAMPORTS) throw new Error("the tip is out of range");
  if (tip > 0n && jitoTipAccount) all.push(SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(jitoTipAccount), lamports: tip }));
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: all }).compileToV0Message(tables);
  const transaction = new VersionedTransaction(message);
  let bytes: Uint8Array;
  try {
    bytes = transaction.serialize();
  } catch {
    throw new Error("this does not fit in one transaction");
  }
  if (bytes.length > MAX_TRANSACTION_BYTES) throw new Error("this does not fit in one transaction");
  remember(transaction, lastValidBlockHeight, kind);
  return { message: transaction, lastValidBlockHeight };
}
let unique = 0;
/** The most anyone may attach as a priority fee or tip: 0.1 SOL. A typing slip must not cost more. */
export const MAX_PRIORITY_LAMPORTS = 100_000_000n;

async function compile(payer: PublicKey, instructions: TransactionInstruction[], computeUnits: number, kind: string, options?: SendOptions): Promise<string> {
  return Buffer.from((await compileMessage(payer, instructions, computeUnits, kind, options)).message.serialize()).toString("base64");
}

/** This site's fee on a trade, as its own instruction, or nothing when the fee is off. */
function feeInstruction(payer: PublicKey, lamports: bigint): { instructions: TransactionInstruction[]; fee: bigint } {
  const { fees } = settings();
  if (lamports <= 0n) return { instructions: [], fee: 0n };
  return { instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(fees.wallet), lamports })], fee: lamports };
}
export const tradeFeeOf = (lamports: bigint): bigint => (lamports * BigInt(settings().fees.tradeBps)) / 10_000n;

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
export async function buildLaunch(request: LaunchRequest): Promise<{ transaction: string; firstBuyTokens: bigint; feeLamports: bigint }> {
  if (request.toRing && request.firstBuyLamports > 0n) assertRing();
  if (ringAvailable()) await bootstrap();
  else if (request.firstBuyLamports > 0n && !state().lookupTable) {
    throw new Error(
      "a launch with a first buy needs this site's lookup table, which has not been made on this network yet. Launch without a first buy, or ask the operator to run the network set-up.",
    );
  }
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
  const fee = feeInstruction(wallet, settings().fees.launchLamports + tradeFeeOf(request.firstBuyLamports));
  instructions.push(...fee.instructions);
  return { transaction: await compile(wallet, instructions, 900_000, "launch"), firstBuyTokens: plan.firstBuyTokens, feeLamports: fee.fee };
}

/**
 * A sealed window's launch: the creator creates the coin and registers it; the escrow wallet makes the first
 * buy with what the window holds, in the same transaction. The server signs for escrow here; the creator and
 * the new coin's key sign in the browser. Changing anything afterwards voids escrow's signature.
 */
export async function buildWindowLaunch(request: {
  wallet: string;
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  /** Everything committed to the window, in lamports. */
  total: bigint;
}): Promise<{ transaction: string; lastValidBlockHeight: number; escrowSignature: string }> {
  assertLocalOnly("The sealed launch window");
  await bootstrap();
  const wallet = new PublicKey(request.wallet);
  const holder = escrow();
  // Sized so that the buy at its 1% slippage limit, plus the rent for escrow's token account, cannot exceed what was committed.
  const spend = ((request.total - RENT_RESERVE_LAMPORTS) * 100n) / 101n;
  const plan = await launchInstructions({
    wallet,
    mint: new PublicKey(request.mint),
    name: request.name,
    symbol: request.symbol,
    uri: request.uri,
    firstBuyLamports: spend,
    buyer: holder.publicKey,
  });
  const compiled = await compileMessage(wallet, plan.instructions, 900_000, "window-launch");
  compiled.message.sign([holder]);
  // Escrow's signature covers the whole message, so it names this exact transaction and no other.
  const signerIndex = compiled.message.message.staticAccountKeys.findIndex((key) => key.equals(holder.publicKey));
  const escrowSignature = bs58.encode(compiled.message.signatures[signerIndex]!);
  return { transaction: Buffer.from(compiled.message.serialize()).toString("base64"), lastValidBlockHeight: compiled.lastValidBlockHeight, escrowSignature };
}

export interface TradeRequest extends SendOptions {
  wallet: string;
  mint: string;
  side: "buy" | "sell";
  amount: bigint;
  /** How far the price may move against the trade before it fails, in hundredths of a percent. */
  slippageBps?: number;
  /** The indexer knows this coin has graduated: the trade goes to its pool without reading the curve first. */
  graduated?: boolean;
}
export interface BuiltTrade {
  transaction: string;
  expected: bigint;
  /** This site's fee in the transaction, in lamports. Zero when the fee is off. */
  feeLamports: bigint;
  lastValidBlockHeight: number;
}
export const DEFAULT_SLIPPAGE_BPS = 200;
export async function buildTrade(request: TradeRequest): Promise<BuiltTrade> {
  const wallet = new PublicKey(request.wallet);
  const slippageBps = request.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5_000) throw new Error("slippage must be between 0.01% and 50%");
  const plan = await tradeInstructions({
    wallet,
    mint: new PublicKey(request.mint),
    side: request.side,
    amount: request.amount,
    slippagePercent: slippageBps / 100,
    graduated: request.graduated,
  });
  const fee = feeInstruction(wallet, tradeFeeOf(plan.lamports));
  const compiled = await compileMessage(wallet, [...plan.instructions, ...fee.instructions], request.graduated ? 400_000 : 300_000, "trade", request);
  return {
    transaction: Buffer.from(compiled.message.serialize()).toString("base64"),
    expected: plan.expected,
    feeLamports: fee.fee,
    lastValidBlockHeight: compiled.lastValidBlockHeight,
  };
}

/** Makes the pool for a coin whose curve has sold out. Public; whoever signs pays the network fee and the pool's rent. */
export async function buildGraduate(request: { wallet: string; mint: string }): Promise<{ transaction: string }> {
  const wallet = new PublicKey(request.wallet);
  return { transaction: await compile(wallet, await graduateInstructions(wallet, new PublicKey(request.mint)), 600_000, "graduate") };
}

/** A deposit into the Ring: public, with its amount. */
export async function buildDeposit(request: { wallet: string; mint: string; amount: bigint }): Promise<{ transaction: string }> {
  const wallet = new PublicKey(request.wallet);
  const tokenProgram = request.mint === NATIVE ? undefined : await tokenProgramOf(request.mint);
  return { transaction: await compile(wallet, depositInstructions(wallet, request.mint, request.amount, tokenProgram), 120_000, "deposit") };
}

/** Claims the creator's fees. The claim is public; with `toRing` the SOL lands in the Ring balance in the same transaction. */
export async function buildClaimFees(request: { wallet: string; toRing: boolean }): Promise<{ transaction: string; claimable: bigint }> {
  const wallet = new PublicKey(request.wallet);
  const claimable = await claimableFees(request.wallet);
  if (claimable <= 0n) throw new Error("there are no creator fees to claim yet");
  if (request.toRing) assertRing();
  const instructions = await claimFeesInstructions(wallet);
  if (request.toRing) instructions.push(...depositInstructions(wallet, NATIVE, claimable));
  return { transaction: await compile(wallet, instructions, 600_000, "claim"), claimable };
}
