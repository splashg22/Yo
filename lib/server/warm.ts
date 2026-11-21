/**
 * What every transaction needs from the chain, kept warm so that building one does not have to ask:
 * a recent blockhash, pump.fun's settings, each coin's token program, this site's lookup table.
 */
import type * as PumpSdk from "@pump-fun/pump-sdk";
import { type AddressLookupTableAccount, PublicKey } from "@solana/web3.js";
import { createRequire } from "node:module";
import { connection } from "./solana";

const sdk = createRequire(import.meta.url)("@pump-fun/pump-sdk") as typeof PumpSdk;

/** A blockhash is good for about a minute. One no older than this is handed out without asking the chain. */
const BLOCKHASH_FRESH_MS = 2_500;
const SETTINGS_FRESH_MS = 60_000;

interface Blockhash {
  blockhash: string;
  lastValidBlockHeight: number;
}
let blockhash: { url: string; at: number; value: Blockhash } | undefined;
let refreshing: Promise<Blockhash> | undefined;
let keeper: ReturnType<typeof setInterval> | undefined;

async function readBlockhash(): Promise<Blockhash> {
  const url = connection().rpcEndpoint;
  refreshing ??= connection()
    .getLatestBlockhash("confirmed")
    .then((value) => {
      blockhash = { url, at: Date.now(), value };
      return value;
    })
    .finally(() => (refreshing = undefined));
  return refreshing;
}
/** A recent blockhash. With the keeper running this never waits on the chain. */
export function recentBlockhash(): Promise<Blockhash> | Blockhash {
  if (blockhash && blockhash.url === connection().rpcEndpoint && Date.now() - blockhash.at < BLOCKHASH_FRESH_MS) return blockhash.value;
  return readBlockhash();
}
/** Keeps the blockhash fresh in the background. Started by the server; tests that do not start it simply read one when they need it. */
export function keepWarm(): () => void {
  keeper ??= setInterval(() => void readBlockhash().catch(() => undefined), 1_000);
  void readBlockhash().catch(() => undefined);
  return () => {
    clearInterval(keeper);
    keeper = undefined;
  };
}

type Global = Awaited<ReturnType<PumpSdk.OnlinePumpSdk["fetchGlobal"]>>;
type FeeConfig = Awaited<ReturnType<PumpSdk.OnlinePumpSdk["fetchFeeConfig"]>>;
let settings: { url: string; at: number; value: Promise<{ global: Global; feeConfig: FeeConfig | null }> } | undefined;
/** pump.fun's global settings and fee schedule. They change rarely: read once a minute at most. */
export function pumpSettings(): Promise<{ global: Global; feeConfig: FeeConfig | null }> {
  const url = connection().rpcEndpoint;
  if (!settings || settings.url !== url || Date.now() - settings.at > SETTINGS_FRESH_MS) {
    const online = new sdk.OnlinePumpSdk(connection());
    // The fee configuration account is optional on-chain; without it the SDK falls back to the global rates.
    const value = Promise.all([online.fetchGlobal(), online.fetchFeeConfig().catch(() => null)]).then(([global, feeConfig]) => ({ global, feeConfig }));
    const mine = { url, at: Date.now(), value };
    settings = mine;
    value.catch(() => {
      if (settings === mine) settings = undefined;
    });
  }
  return settings.value;
}

const tokenPrograms = new Map<string, PublicKey>();
/** Which token program a coin belongs to. It never changes, so it is asked once. */
export async function tokenProgramOf(mint: string): Promise<PublicKey> {
  const key = `${connection().rpcEndpoint}|${mint}`;
  const known = tokenPrograms.get(key);
  if (known) return known;
  const info = await connection().getAccountInfo(new PublicKey(mint));
  if (!info) throw new Error("that coin does not exist on this chain");
  tokenPrograms.set(key, info.owner);
  return info.owner;
}
/** Told by the indexer, which sees a coin made: saves the question later. */
export function rememberTokenProgram(mint: string, program: PublicKey): void {
  tokenPrograms.set(`${connection().rpcEndpoint}|${mint}`, program);
}

const tables = new Map<string, { at: number; value: AddressLookupTableAccount | null }>();
/** This site's lookup table, read at most once a minute. */
export async function lookupTable(address: string): Promise<AddressLookupTableAccount | null> {
  const key = `${connection().rpcEndpoint}|${address}`;
  const known = tables.get(key);
  if (known?.value && Date.now() - known.at < SETTINGS_FRESH_MS) return known.value;
  const value = (await connection().getAddressLookupTable(new PublicKey(address))).value;
  tables.set(key, { at: Date.now(), value });
  return value;
}

/** Tests only: forget everything, as a restarted server would. */
export function forgetWarm(): void {
  blockhash = undefined;
  settings = undefined;
  tokenPrograms.clear();
  tables.clear();
}
