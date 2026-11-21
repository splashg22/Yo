/**
 * MOCK of the Privacy Ring, for a local validator.
 *
 * The real Ring keeps encrypted balances on-chain and needs Helius's indexer and prover,
 * which do not exist on a local chain. This stands in for it with a ledger that follows
 * the same visibility rules (lib/visibility.ts): deposits and withdrawals are public with
 * their amounts; a transfer shows both wallets and seals the coin and the amount.
 * Deposited coins really move on the local chain, into an escrow wallet (lib/server/chain.ts).
 */
import { randomBytes, toHex } from "../bytes";
import { assertLocalOnly } from "./env";
import { save, state, type RingEvent } from "./store";

const big = (text: string | undefined) => BigInt(text ?? "0");

function move(wallet: string, mint: string, delta: bigint): void {
  const s = state();
  const mine = (s.balances[wallet] ??= {});
  const next = big(mine[mint]) + delta;
  if (next < 0n) throw new Error("the Ring balance is too low");
  if (next === 0n) delete mine[mint]; else mine[mint] = next.toString();
}
function record(event: Omit<RingEvent, "id" | "at">, at = Date.now()): RingEvent {
  const full = { id: toHex(randomBytes(8)), at, ...event };
  state().events.push(full);
  return full;
}

export const ring = {
  isRegistered: (wallet: string) => state().registered.includes(wallet),

  /** A wallet must publish its Ring keys once before it can receive a transfer. Public. */
  register(wallet: string): RingEvent | null {
    assertLocalOnly("The mock Ring");
    if (state().registered.includes(wallet)) return null;
    state().registered.push(wallet);
    const event = record({ kind: "register", public: { wallet }, sealed: {}, parties: [wallet] });
    save();
    return event;
  },

  /** Credits coins that arrived in escrow. Public: wallet, coin, amount. */
  credit(wallet: string, mint: string, amount: bigint, signature: string): RingEvent {
    assertLocalOnly("The mock Ring");
    if (amount <= 0n) throw new Error("nothing to credit");
    if (!state().registered.includes(wallet)) state().registered.push(wallet);
    move(wallet, mint, amount);
    const event = record({ kind: "deposit", public: { wallet, coin: mint, amount: amount.toString() }, sealed: {}, parties: [wallet], signature });
    save();
    return event;
  },

  /** Between Ring balances. Public: both wallets and the time. Sealed: coin, amount, memo. */
  transfer(from: string, to: string, mint: string, amount: bigint, memo?: string): RingEvent {
    assertLocalOnly("The mock Ring");
    if (amount <= 0n) throw new Error("the amount must be above zero");
    if (from === to) throw new Error("a transfer needs a different recipient");
    if (!state().registered.includes(to)) throw new Error("the recipient is not registered with the Ring yet");
    move(from, mint, -amount);
    move(to, mint, amount);
    const event = record({
      kind: "transfer", public: { from, to },
      sealed: { coin: mint, amount: amount.toString(), ...(memo ? { memo: memo.slice(0, 140) } : {}) }, parties: [from, to],
    });
    save();
    return event;
  },

  /** Takes coins out of a Ring balance. The caller then pays them out on-chain. Public: wallet, destination, coin, amount. */
  debitForWithdrawal(wallet: string, mint: string, amount: bigint, destination: string): RingEvent {
    assertLocalOnly("The mock Ring");
    if (amount <= 0n) throw new Error("the amount must be above zero");
    move(wallet, mint, -amount);
    const event = record({ kind: "withdraw", public: { wallet, destination, coin: mint, amount: amount.toString() }, sealed: {}, parties: [wallet] });
    save();
    return event;
  },
  /** Puts a failed withdrawal back. */
  undoWithdrawal(event: RingEvent): void {
    move(event.public.wallet!, event.public.coin!, BigInt(event.public.amount!));
    state().events = state().events.filter((e) => e.id !== event.id);
    save();
  },
  attach(event: RingEvent, signature: string): void {
    event.signature = signature;
    save();
  },

  /** An OTC block: coin one way, payment the other, both or neither. Sealed: coin, size, price. */
  swap(seller: string, buyer: string, mint: string, amount: bigint, payMint: string, price: bigint): RingEvent {
    assertLocalOnly("The mock Ring");
    if (big(state().balances[seller]?.[mint]) < amount) throw new Error("the seller no longer holds the block in the Ring");
    if (big(state().balances[buyer]?.[payMint]) < price) throw new Error("the buyer's Ring balance does not cover the price");
    move(seller, mint, -amount); move(buyer, mint, amount);
    move(buyer, payMint, -price); move(seller, payMint, price);
    const event = record({ kind: "otc", public: { seller, buyer }, sealed: { coin: mint, size: amount.toString(), price: price.toString(), paidIn: payMint }, parties: [seller, buyer] });
    save();
    return event;
  },

  balances(wallet: string): Record<string, string> {
    return { ...(state().balances[wallet] ?? {}) };
  },
  /** A wallet's own history, sealed parts included. */
  history(wallet: string): RingEvent[] {
    return state().events.filter((e) => e.parties.includes(wallet)).slice(-200).reverse();
  },
  /** What anyone can see: every event with its sealed part removed. */
  publicView(wallet?: string): Omit<RingEvent, "sealed" | "parties">[] {
    return state().events
      .filter((e) => !wallet || Object.values(e.public).includes(wallet))
      .slice(-200).reverse()
      .map(({ sealed: _sealed, parties: _parties, ...rest }) => rest);
  },

  /**
   * The two public facts behind the privacy score. Both are visible on-chain for the real
   * Ring too: the coin's escrow balance, and the wallets that have made a deposit.
   */
  coinStats(mint: string): { inRing: bigint; depositors: number } {
    let inRing = 0n;
    for (const wallet of Object.values(state().balances)) inRing += big(wallet[mint]);
    const depositors = new Set(state().events.filter((e) => e.kind === "deposit" && e.public.coin === mint).map((e) => e.public.wallet));
    return { inRing, depositors: depositors.size };
  },
};
