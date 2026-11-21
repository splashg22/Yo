/** Configuration, health, the local faucet, and submitting and looking up transactions. */
import { PublicKey } from "@solana/web3.js";
import { NATIVE } from "../../constants";
import type { Status, TransactionView } from "../../contract";
import { airdrop } from "../bootstrap";
import { settings } from "../env";
import { escrow, escrowBalance } from "../escrow";
import { ring } from "../ring";
import { settle } from "../settle";
import { connection, explain } from "../solana";
import { state } from "../store";
import { sendSigned } from "../transactions";
import { addressOf, signatureOf, text } from "../validate";
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
    ring: "mock",
    checkedAt: Date.now(),
    chain: { reachable: false },
    programs: [],
    launchTable: false,
    coins: store.coins.length,
    escrowAddress: escrow().publicKey.toBase58(),
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
  for (const mint of [NATIVE, ...store.coins.map((coin) => coin.mint)]) {
    const owed = ring.total(mint);
    if (owed === 0n) continue;
    const held = await escrowBalance(mint);
    base.escrow.push({ mint, held: held.toString(), owed: owed.toString(), covered: held >= owed });
  }
  return base;
}

async function transactionView(signature: string): Promise<TransactionView> {
  const found = await connection().getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!found?.meta) return { signature, status: "not-found", programs: [], deposits: [] };
  const keys = found.transaction.message.getAccountKeys({ accountKeysFromLookups: found.meta.loadedAddresses });
  const invoked = new Set(
    (found.meta.logMessages ?? []).map((line) => /^Program (\S+) invoke \[1\]$/.exec(line)?.[1]).filter((id): id is string => id !== undefined),
  );
  return {
    signature,
    status: found.meta.err ? "failed" : "confirmed",
    slot: found.slot,
    blockTime: found.blockTime ?? undefined,
    feeLamports: String(found.meta.fee),
    payer: keys.get(0)?.toBase58(),
    programs: [...invoked],
    deposits: state()
      .events.filter((event) => event.signature === signature && event.kind === "deposit")
      .map((event) => event.public),
  };
}

export const system: Handlers<"config" | "status" | "faucet" | "tx/send" | "tx/status"> = {
  config: () => ({ network: settings().network, ring: "mock" }),

  status,

  faucet: async (input) => {
    await airdrop(new PublicKey(addressOf(input.wallet, "wallet address")), 10);
    return { ok: true as const };
  },

  /**
   * Submits a transaction the wallet has signed, waits for it, and settles it: anything it
   * paid into the Ring is credited and a coin it launched is listed, here, before the
   * answer goes back. A browser that closes mid-request loses nothing.
   */
  "tx/send": async (input) => {
    const signature = await sendSigned(text(input.transaction, "transaction", 4_000));
    return { signature, ...(await settle(signature)) };
  },

  "tx/status": async (input) => transactionView(signatureOf(input.signature)),
};
