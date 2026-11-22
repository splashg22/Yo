/** Configuration, health, the local faucet, and submitting and looking up transactions. */
import { PublicKey, type ConfirmedTransactionMeta } from "@solana/web3.js";
import { NATIVE } from "../../constants";
import type { Config, Status, TransactionView, TxOutcomeView } from "../../contract";
import { forgetBalances } from "../balances";
import { airdrop } from "../bootstrap";
import { ringAvailable, settings } from "../env";
import { escrow, escrowBalance } from "../escrow";
import { ring } from "../ring";
import { settled, submit, type TxOutcome } from "../sender";
import { closeSession, openSession } from "../sessions";
import { NEWEST_TRANSACTION_VERSION, connection, explain, rawCall } from "../solana";
import { state } from "../store";
import { solPrice } from "../usd";
import { addressOf, signatureOf, text } from "../validate";
import { ringGateOpen } from "../ringgate";
import { verifiedBody } from "./ring";

/** Which Ring this deployment has: the local stand-in, the real program through the gate, or none. */
const ringMode = (): "mock" | "real" | "unavailable" => (ringAvailable() ? "mock" : ringGateOpen() ? "real" : "unavailable");
import type { Handlers } from "./types";

const PROGRAMS = [
  { name: "pump.fun", address: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P" },
  { name: "Privacy Rings", address: "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW" },
  { name: "Rings user registry", address: "regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ" },
];

/** Everything on this page is read at the moment of the request. Nothing is remembered between calls. */
async function status(): Promise<Status> {
  const { network } = settings();
  const store = state();
  const base: Status = {
    network,
    ring: ringMode(),
    checkedAt: Date.now(),
    chain: { reachable: false },
    programs: [],
    launchTable: false,
    coins: store.coins.length,
    escrowAddress: ringAvailable() ? escrow().publicKey.toBase58() : "",
    escrow: [],
    pendingPayouts: store.pendingPayouts.length,
  };
  const chain = connection();
  try {
    const [slot, version] = await Promise.all([chain.getSlot(), chain.getVersion()]);
    base.chain = { reachable: true, slot, version: version["solana-core"] };
  } catch (error) {
    base.chain = { reachable: false, problem: explain(error) };
    return base;
  }
  const infos = await chain.getMultipleAccountsInfo(PROGRAMS.map((program) => new PublicKey(program.address)));
  base.programs = PROGRAMS.map((program, index) => ({ ...program, present: infos[index]?.executable === true }));
  base.launchTable = store.lookupTable !== undefined && (await chain.getAccountInfo(new PublicKey(store.lookupTable))) !== null;
  for (const mint of ringAvailable() ? [NATIVE, ...store.coins.map((coin) => coin.mint)] : []) {
    const owed = ring.total(mint);
    if (owed === 0n) continue;
    const held = await escrowBalance(mint);
    base.escrow.push({ mint, held: held.toString(), owed: owed.toString(), covered: held >= owed });
  }
  return base;
}

/** What the paying wallet's own balances did, from the balances the chain recorded before and after. */
function payerChanges(meta: ConfirmedTransactionMeta, payer: string | undefined): TransactionView["changes"] {
  const changes: TransactionView["changes"] = [];
  const sol = BigInt(meta.postBalances[0] ?? 0) - BigInt(meta.preBalances[0] ?? 0);
  if (sol !== 0n) changes.push({ mint: NATIVE, amount: sol.toString() });
  const held = (balances: ConfirmedTransactionMeta["preTokenBalances"]): Map<string, bigint> => {
    const totals = new Map<string, bigint>();
    for (const balance of balances ?? []) {
      if (balance.owner === payer) totals.set(balance.mint, (totals.get(balance.mint) ?? 0n) + BigInt(balance.uiTokenAmount.amount));
    }
    return totals;
  };
  const [before, after] = [held(meta.preTokenBalances), held(meta.postTokenBalances)];
  for (const mint of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(mint) ?? 0n) - (before.get(mint) ?? 0n);
    if (delta !== 0n) changes.push({ mint, amount: delta.toString() });
  }
  return changes;
}

async function transactionView(signature: string): Promise<TransactionView> {
  // Read as plain JSON, so a version 1 transaction (the Privacy Rings program sends those) has a receipt like any other.
  const found = await rawCall<{
    slot: number;
    blockTime: number | null;
    meta: ConfirmedTransactionMeta | null;
    transaction: { message: { accountKeys: string[] } };
  }>(connection(), "getTransaction", [signature, { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: NEWEST_TRANSACTION_VERSION }]);
  if (!found?.meta) return { signature, status: "not-found", programs: [], changes: [], deposits: [] };
  const invoked = new Set(
    (found.meta.logMessages ?? []).map((line) => /^Program (\S+) invoke \[1\]$/.exec(line)?.[1]).filter((id): id is string => id !== undefined),
  );
  const payer = found.transaction.message.accountKeys[0];
  return {
    signature,
    status: found.meta.err ? "failed" : "confirmed",
    slot: found.slot,
    blockTime: found.blockTime ?? undefined,
    feeLamports: String(found.meta.fee),
    payer,
    programs: [...invoked],
    changes: payerChanges(found.meta, payer),
    deposits: state()
      .events.filter((event) => event.signature === signature && event.kind === "deposit")
      .map((event) => event.public),
  };
}

const outcomeView = (outcome: TxOutcome): TxOutcomeView => ({
  signature: outcome.signature,
  state: outcome.state,
  ...(outcome.slot === undefined ? {} : { slot: outcome.slot }),
  ...(outcome.problem === undefined ? {} : { problem: outcome.problem }),
  ...(outcome.settlement === undefined ? {} : { settlement: outcome.settlement }),
  ...(outcome.landedInMs === undefined ? {} : { landedInMs: outcome.landedInMs }),
});

/** What this build runs on: the answer to `config`, and what the server hands to every page it renders. */
export function buildConfig(): Config {
  const { network, features, fees } = settings();
  return {
    network,
    ring: ringMode(),
    features,
    fees: { wallet: fees.wallet, tradeBps: fees.tradeBps, launchLamports: fees.launchLamports.toString(), otcBps: fees.otcBps },
  };
}

export const system: Handlers<"config" | "status" | "faucet" | "price/sol" | "tx/send" | "tx/wait" | "tx/status" | "session/open" | "session/close"> = {
  config: () => buildConfig(),

  status,

  faucet: async (input) => {
    const wallet = addressOf(input.wallet, "wallet address");
    await airdrop(new PublicKey(wallet), 10);
    forgetBalances(wallet);
    return { ok: true as const };
  },

  /**
   * Hands a signed transaction to the network and answers at once. The sender keeps sending it until it is
   * confirmed or expired, then settles it (anything it paid into the Ring is credited, a coin it launched is
   * listed) whether or not the browser is still there.
   */
  "tx/send": async (input) => outcomeView(await submit(text(input.transaction, "transaction", 4_000), { fast: input.fast === true })),

  "tx/wait": async (input) => {
    const signature = signatureOf(input.signature);
    const ms = input.ms === undefined ? 20_000 : input.ms;
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0 || ms > 25_000) throw new Error('"ms" must be between 0 and 25000');
    const outcome = await settled(signature, ms);
    if (!outcome) throw new Error("this server has no record of sending that transaction");
    return outcomeView(outcome);
  },

  "price/sol": async () => ({ price: await solPrice() }),

  "tx/status": async (input) => transactionView(signatureOf(input.signature)),

  /** One signature from the wallet opens a session. It can read that wallet's own records and upload a picture; it cannot move anything. */
  "session/open": (input) => openSession(verifiedBody("session/open", input).wallet),
  "session/close": (input) => {
    closeSession(input.session);
    return { ok: true as const };
  },
};
