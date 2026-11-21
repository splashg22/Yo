/**
 * What the server does once a transaction is confirmed: credit the Ring ledger with
 * anything it paid into escrow, and list a coin it launched. Run by the server itself the
 * moment it submits a transaction, so nothing depends on the browser coming back.
 */
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import type { Settlement } from "../contract";
import { ringAvailable } from "./env";
import { escrow, escrowReceipts, payoutStatus, type Receipts } from "./escrow";
import { curveExists, curveOf, tokenProgramOf } from "./pump";
import { ring } from "./ring";
import { connection } from "./solana";
import { save, state, type Coin, type RingEvent } from "./store";
import { windows } from "./windows";

/** Withdrawals between "taken out of the balance" and "payout on record", in this process. `reconcile` must not undo these. */
export const preparing = new Set<string>();

/** Signatures being settled right now, in this process. Kept in memory: a claim is only put on record together with what it credits. */
const inFlight = new Set<string>();

/**
 * Safe to call any number of times, from any number of requests at once, for the same signature: only
 * one caller works on it at a time, and once it is on record as settled nobody does again.
 *
 * Everything that has to be read from the chain is read first. The ledger is then changed in one step
 * with no waiting in it, and the signature is recorded as settled in that same step. A failure or a
 * crash before that step leaves nothing changed, so a later call or `reconcile` simply does it again.
 */
export async function settle(signature: string): Promise<Settlement> {
  const store = state();
  if (store.credited.includes(signature) || inFlight.has(signature)) return { credited: [], listed: [] };
  inFlight.add(signature);
  try {
    // Without the stand-in Ring there is no escrow to have received anything: only the launch, if it was one, is recorded.
    const receipts = ringAvailable() ? await escrowReceipts(signature) : await plainReceipt(signature);
    const launches = await launchesToList(receipts.accounts, receipts.payer);

    // ---- no awaits from here to the end of the step ----
    if (store.credited.includes(signature)) return { credited: [], listed: [] };
    // A sealed window's launch is recognised by the signature escrow put on it when this server built it. Nothing
    // else can stand in for it: not a transaction that merely names the coin, and not one built by anyone else.
    const launched = store.windows.find(
      (window) =>
        window.status === "launching" && window.launching?.escrowSignature !== undefined && receipts.signatures.includes(window.launching.escrowSignature),
    );
    let credits = receipts.receipts;
    if (launched?.launching) {
      const mint = launched.launching.mint;
      const received = credits.filter((receipt) => receipt.mint === mint).reduce((sum, receipt) => sum + receipt.amount, 0n);
      windows.fill(launched, mint, received, receipts.spent, signature);
      credits = [];
    } else if (receipts.escrowSigned) {
      // Escrow signs only its own payouts and window launches. Whatever reached escrow in a transaction it signed
      // is not a deposit by whoever paid the fee, and is never credited as one.
      credits = [];
    }
    const events: RingEvent[] = credits.map((receipt) => ring.credit(receipts.payer, receipt.mint, receipt.amount, signature));
    const listed = launches.map((launch) => {
      store.coins.push({ ...launch, createdAt: Date.now(), signature });
      delete store.pendingLaunches[launch.mint];
      return launch.mint;
    });
    store.credited.push(signature);
    save();
    return { credited: events.map((event) => event.public), listed };
  } finally {
    inFlight.delete(signature);
  }
}

/** Which coins this transaction launched that this site should list: built here, for this payer, and the creator on-chain is that wallet. Reads only. */
async function launchesToList(accounts: string[], payer: string): Promise<Omit<Coin, "createdAt" | "signature">[]> {
  const store = state();
  const found: Omit<Coin, "createdAt" | "signature">[] = [];
  for (const mint of accounts) {
    const pending = store.pendingLaunches[mint];
    if (!pending || pending.wallet !== payer || store.coins.some((coin) => coin.mint === mint)) continue;
    if (!(await curveExists(mint))) continue;
    const curve = await curveOf(mint);
    if (curve.creator !== pending.wallet) continue;
    found.push({ mint, name: pending.name, symbol: pending.symbol, creator: curve.creator, ...(pending.image ? { image: pending.image } : {}) });
  }
  return found;
}

/** What a confirmed transaction touched and who paid for it, where there is no escrow to look for. */
async function plainReceipt(signature: string): Promise<Receipts> {
  const transaction = await connection().getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!transaction?.meta) throw new Error("that transaction is not confirmed on this chain");
  if (transaction.meta.err) throw new Error("that transaction failed on-chain");
  const keys = transaction.transaction.message.getAccountKeys({ accountKeysFromLookups: transaction.meta.loadedAddresses });
  const accounts = Array.from({ length: keys.length }, (_, index) => keys.get(index)!.toBase58());
  return { payer: accounts[0]!, accounts, receipts: [], spent: 0n, signatures: transaction.transaction.signatures, escrowSigned: false };
}

export async function reconcile(): Promise<{ credited: number; payoutsResolved: number }> {
  if (!ringAvailable()) return { credited: 0, payoutsResolved: 0 };
  const chain = connection();
  const store = state();
  const owner = escrow().publicKey;
  const watched: PublicKey[] = [owner];
  for (const coin of store.coins) watched.push(getAssociatedTokenAddressSync(new PublicKey(coin.mint), owner, false, await tokenProgramOf(coin.mint)));
  let credited = 0;
  for (const account of watched) {
    // Newest first, a page at a time, until a page holds nothing new. "confirmed", so nothing that has landed is missed.
    let before: string | undefined;
    for (let page = 0; page < 20; page++) {
      const entries = await chain.getSignaturesForAddress(account, { limit: 100, before }, "confirmed");
      let unseen = 0;
      for (const entry of entries) {
        if (entry.err || store.credited.includes(entry.signature)) continue;
        unseen += 1;
        credited += (await settle(entry.signature)).credited.length;
      }
      if (entries.length < 100 || unseen === 0) break;
      before = entries[entries.length - 1]!.signature;
    }
  }
  let payoutsResolved = 0;
  for (const payout of [...store.pendingPayouts]) {
    const outcome = await payoutStatus(payout.signature, payout.lastValidBlockHeight, 3);
    if (outcome.status === "unknown") continue;
    if (outcome.status === "landed") ring.completeWithdrawal(payout.eventId, payout.signature);
    else ring.undoWithdrawal(payout.eventId);
    store.pendingPayouts = store.pendingPayouts.filter((candidate) => candidate.eventId !== payout.eventId);
    payoutsResolved += 1;
  }
  // A withdrawal taken out of a balance with no payout on record was never sent: the payout is recorded before it
  // is sent. It is left over from a crash between the two steps, and the coins go back. One being prepared at this
  // moment is left alone.
  for (const event of [...store.events]) {
    if (event.kind !== "withdraw" || !event.pending || preparing.has(event.id)) continue;
    if (store.pendingPayouts.some((payout) => payout.eventId === event.id)) continue;
    ring.undoWithdrawal(event.id);
    payoutsResolved += 1;
  }
  save();
  return { credited, payoutsResolved };
}
