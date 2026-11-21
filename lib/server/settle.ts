/**
 * What the server does once a transaction is confirmed: credit the Ring ledger with
 * anything it paid into escrow, and list a coin it launched. Run by the server itself the
 * moment it submits a transaction, so nothing depends on the browser coming back.
 */
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import type { Settlement } from "../contract";
import { escrow, escrowReceipts, payoutStatus } from "./escrow";
import { curveExists, curveOf, tokenProgramOf } from "./pump";
import { ring } from "./ring";
import { connection } from "./solana";
import { save, state, type RingEvent } from "./store";
import { windows } from "./windows";

/**
 * Safe to call any number of times, from any number of requests at once, for the same
 * signature: the signature is claimed before the first await, so only one caller credits.
 */
export async function settle(signature: string): Promise<Settlement> {
  const store = state();
  if (store.credited.includes(signature)) return { credited: [], listed: [] };
  store.credited.push(signature);
  let receipts;
  try {
    receipts = await escrowReceipts(signature);
  } catch (error) {
    // Nothing was credited: release the claim so a later call can try again.
    store.credited = store.credited.filter((claimed) => claimed !== signature);
    throw error;
  }
  // A sealed window's launch: the coins that reached escrow belong to the window's committers, not to whoever paid the fee.
  const launched = store.windows.find((window) => window.status === "launching" && window.launching && receipts.accounts.includes(window.launching.mint));
  if (launched?.launching) {
    const mint = launched.launching.mint;
    const received = receipts.receipts.filter((receipt) => receipt.mint === mint).reduce((sum, receipt) => sum + receipt.amount, 0n);
    windows.fill(launched, mint, received, receipts.spent, signature);
    receipts.receipts = receipts.receipts.filter((receipt) => receipt.mint !== mint);
  }
  const events: RingEvent[] = receipts.receipts.map((receipt) => ring.credit(receipts.payer, receipt.mint, receipt.amount, signature));
  const listed = await listLaunches(receipts.accounts, receipts.payer, signature);
  save();
  return { credited: events.map((event) => event.public), listed };
}

/** Lists a coin only if this site built its launch, the creator on-chain is the wallet it was built for, and the curve exists. */
async function listLaunches(accounts: string[], payer: string, signature: string): Promise<string[]> {
  const store = state();
  const listed: string[] = [];
  for (const mint of accounts) {
    const pending = store.pendingLaunches[mint];
    if (!pending || pending.wallet !== payer || store.coins.some((coin) => coin.mint === mint)) continue;
    if (!(await curveExists(mint))) continue;
    const curve = await curveOf(mint);
    if (curve.creator !== pending.wallet) continue;
    store.coins.push({
      mint,
      name: pending.name,
      symbol: pending.symbol,
      creator: curve.creator,
      createdAt: Date.now(),
      signature,
      ...(pending.image ? { image: pending.image } : {}),
    });
    delete store.pendingLaunches[mint];
    listed.push(mint);
  }
  return listed;
}

/**
 * Repairs anything a crash or a dead connection left half done: deposits that reached
 * escrow but were never credited, and withdrawals whose payout was sent but never confirmed.
 */
export async function reconcile(): Promise<{ credited: number; payoutsResolved: number }> {
  const chain = connection();
  const store = state();
  const owner = escrow().publicKey;
  const watched: PublicKey[] = [owner];
  for (const coin of store.coins) watched.push(getAssociatedTokenAddressSync(new PublicKey(coin.mint), owner, false, await tokenProgramOf(coin.mint)));
  let credited = 0;
  for (const account of watched) {
    for (const entry of await chain.getSignaturesForAddress(account, { limit: 100 })) {
      if (entry.err || store.credited.includes(entry.signature)) continue;
      credited += (await settle(entry.signature)).credited.length;
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
  save();
  return { credited, payoutsResolved };
}
