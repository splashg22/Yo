/** Shared by the flow tests: a fresh server state per test file, funded wallets, and independent reads of the chain. */
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NATIVE } from "../../lib/constants";
import bs58 from "bs58";
import { randomBytes } from "../../lib/bytes";
import { newActor } from "../../lib/keys";
import { RingClient, type Transport } from "../../lib/sdk";
import { escrow } from "../../lib/server/escrow";
import { run } from "../../lib/server/handlers";
import { ring } from "../../lib/server/ring";
import { forget } from "../../lib/server/store";

export const RPC_URL = "http://127.0.0.1:8799";
export const SOL = 1_000_000_000n;
export const RING_PROGRAM = "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW";
export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

/** Points the server code at a new, empty state directory and the local validator. Call once at the top of a test file. */
export function freshServer(): void {
  process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "ring-flows-"));
  // With DATABASE_URL set the same tests run against Postgres. Each test file gets a schema of its own, as it gets a folder of its own.
  if (process.env.DATABASE_URL) process.env.DATABASE_SCHEMA = `t_${randomBytes(6).reduce((text, byte) => text + byte.toString(16).padStart(2, "0"), "")}`;
  process.env.RING_NETWORK = "local";
  process.env.LOCAL_RPC_URL = RPC_URL;
  delete process.env.RPC_TIMEOUT_MS;
  forget();
}

/** Calls an operation directly, the way the HTTP route does. */
export const call: Transport = (name, input = {}) => run(name, input as Record<string, unknown>);

/** As if the server process had restarted: what is in memory is dropped and read again from disk. */
export const restartServer = (): void => forget();

export async function fundedClient(): Promise<RingClient> {
  const client = new RingClient(call, newActor());
  await call("faucet", { wallet: client.address });
  return client;
}

/** The chain itself, asked directly: nothing here goes through the code under test. */
export const chain = new Connection(RPC_URL, "confirmed");

export async function onChain(owner: string, mint: string): Promise<bigint> {
  const key = new PublicKey(owner);
  if (mint === NATIVE) return BigInt(await chain.getBalance(key));
  const account = getAssociatedTokenAddressSync(new PublicKey(mint), key, true, TOKEN_2022_PROGRAM_ID);
  const info = await chain.getAccountInfo(account);
  if (!info) return 0n;
  return BigInt((await chain.getTokenAccountBalance(account)).value.amount);
}

/** What the mock Ring's escrow wallet really holds on-chain. */
export const escrowOnChain = (mint: string): Promise<bigint> => onChain(escrow().publicKey.toBase58(), mint);

/**
 * The invariant that matters most: for a coin, escrow holds on-chain exactly what the
 * ledger says is in Ring balances. (For SOL, at least as much: escrow also keeps a float for fees.)
 */
export async function expectCovered(mint: string): Promise<void> {
  const held = await escrowOnChain(mint);
  const owed = ring.total(mint);
  if (mint === NATIVE ? held < owed : held !== owed) throw new Error(`escrow holds ${held} of ${mint} on-chain but the ledger owes ${owed}`);
}

export async function logsOf(signature: string): Promise<string[]> {
  const transaction = await chain.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!transaction?.meta) throw new Error(`transaction ${signature} is not on the chain`);
  if (transaction.meta.err) throw new Error(`transaction ${signature} failed`);
  return transaction.meta.logMessages ?? [];
}

/** A well-formed signature that no transaction has. */
export const unknownSignature = (): string => bs58.encode(randomBytes(64));
