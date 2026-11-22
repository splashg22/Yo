/**
 * One interface to Ring balances, with two things behind it.
 *
 * - "standin": this site's own server keeps the balances. It is custodial and it can read everything. It
 *   exists only beside a local validator, for building and testing without a network.
 * - "real": the Privacy Rings program on the chain, through its SDK running in the vault worker with the
 *   wallet's own keys. This site's server holds nothing and can read nothing of a balance.
 *
 * Pages use this interface and never ask which one they have, except to say so honestly on screen.
 */
import type { Config, RingEvent } from "../contract";
import type { SealedNote } from "../notes";
import { api, sessionApi, signAndSend, signedApi, type Signer } from "./api";
import { vault } from "./vault";

export interface RingView {
  registered: boolean;
  balances: Record<string, string>;
  history: RingEvent[];
}
export interface RingProgress {
  /** The network has the transaction. */
  sent?: (signature: string) => void;
  /** What is happening now, in words: "asking the prover for a proof". */
  stage?: (text: string) => void;
}
export interface RingBackend {
  readonly kind: "standin" | "real";
  /** A wallet must send a transaction of its own to register (real), or is registered by signing in (stand-in). */
  readonly registersOnChain: boolean;
  /** Notes can be attached to a transfer. The real Ring's transfer carries none. */
  readonly notes: boolean;
  mine(signer: Signer): Promise<RingView>;
  register(signer: Signer, progress?: RingProgress): Promise<void>;
  deposit(signer: Signer, mint: string, amount: bigint, progress?: RingProgress): Promise<{ signature: string }>;
  transfer(signer: Signer, to: string, mint: string, amount: bigint, note: SealedNote | undefined, progress?: RingProgress): Promise<{ signature?: string }>;
  withdraw(
    signer: Signer,
    mint: string,
    amount: bigint,
    destination: string | undefined,
    progress?: RingProgress,
  ): Promise<{ signature: string; pending: boolean }>;
}

const standin: RingBackend = {
  kind: "standin",
  registersOnChain: false,
  notes: true,
  mine: (signer) => sessionApi("ring/mine", signer),
  register: async (signer) => {
    await signedApi("ring/register", signer, {});
  },
  deposit: async (signer, mint, amount, progress) => {
    const { transaction } = await api("ring/deposit/build", { wallet: signer.address, mint, amount: amount.toString() });
    return { signature: (await signAndSend(signer, transaction, undefined, progress?.sent)).signature };
  },
  transfer: async (signer, to, mint, amount, note) => {
    await signedApi("ring/transfer", signer, { to, mint, amount: amount.toString(), note });
    return {};
  },
  withdraw: async (signer, mint, amount, destination) => {
    const result = await signedApi("ring/withdraw", signer, { mint, amount: amount.toString(), destination });
    return { signature: result.signature, pending: result.pending };
  },
};

/** The real Ring's rows, in the shape the history table shows. What is public and what only this wallet's keys read are kept apart, as on the chain. */
function eventsOf(
  rows: { id: string; signature: string; slot: number; kind: string; direction: string; mint: string; amount: string }[],
  me: string,
): RingEvent[] {
  return rows.map((row): RingEvent => {
    const kind = row.kind === "deposit" ? "deposit" : row.kind === "withdraw" ? "withdraw" : "transfer";
    const open: Record<string, string> = { slot: String(row.slot) };
    const sealed: Record<string, string> = {};
    if (kind === "transfer") {
      open[row.direction === "in" ? "to" : "from"] = me;
      sealed.coin = row.mint;
      sealed.amount = row.amount;
    } else {
      open.wallet = me;
      open.coin = row.mint;
      open.amount = row.amount;
    }
    // The Ring's records carry the slot, not a clock time; the table shows the slot.
    return { id: row.id, at: 0, kind, public: open, sealed, parties: [me], signature: row.signature };
  });
}
function mustBeBrowser(signer: Signer): void {
  if (signer.kind !== "browser")
    throw new Error(
      "the real Ring works with a wallet made in this browser for now. Whether wallet extensions can sign its transactions is not yet proven (RING-RESULTS.md).",
    );
}
const real: RingBackend = {
  kind: "real",
  registersOnChain: true,
  notes: false,
  mine: async (signer) => {
    mustBeBrowser(signer);
    const state = await vault.ring({ op: "ring:state" });
    return { registered: state.registered, balances: state.balances, history: eventsOf(state.history, signer.address) };
  },
  register: async (signer, progress) => {
    mustBeBrowser(signer);
    const done = await vault.ring({ op: "ring:register" }, progress?.stage);
    if (done.signature) progress?.sent?.(done.signature);
  },
  deposit: async (signer, mint, amount, progress) => {
    mustBeBrowser(signer);
    const done = await vault.ring({ op: "ring:deposit", mint, amount: amount.toString() }, progress?.stage);
    return { signature: done.signature! };
  },
  transfer: async (signer, to, mint, amount, _note, progress) => {
    mustBeBrowser(signer);
    return { signature: (await vault.ring({ op: "ring:transfer", to, mint, amount: amount.toString() }, progress?.stage)).signature };
  },
  withdraw: async (signer, mint, amount, destination, progress) => {
    mustBeBrowser(signer);
    const done = await vault.ring({ op: "ring:withdraw", mint, amount: amount.toString(), destination: destination ?? signer.address }, progress?.stage);
    return { signature: done.signature!, pending: false };
  },
};

/** The Ring behind this deployment, or null where there is none. */
export const ringBackend = (config: Config | "offline" | null): RingBackend | null =>
  config === null || config === "offline" ? null : config.ring === "mock" ? standin : config.ring === "real" ? real : null;
