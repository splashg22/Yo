/**
 * The sealed launch window. Off unless FEATURE_SEALED_WINDOW=on.
 *
 * Before a coin exists, buyers commit SOL from their Ring balances to a window its creator
 * opened. When the window has closed, the creator launches: one transaction creates the
 * coin and, in that same transaction, buys with everything committed. Nobody can buy
 * earlier, because there is nothing to buy; every committer gets the same price. The coins
 * are then shared out in proportion to what each put in, and any SOL not spent goes back.
 *
 * This HOLDS BUYERS' FUNDS. In this build the holder is the stand-in's escrow wallet, which
 * exists only on a local test chain. It must not be switched on anywhere else as it stands.
 *
 * Money rules kept here:
 * - A commitment leaves the committer's Ring balance for the window's own ledger account,
 *   so the ledger's total, and what escrow must hold, never change by committing.
 * - While a launch transaction may still land, the window is locked: nothing can be added,
 *   taken back or cancelled, so the transaction always spends exactly what is there.
 * - The buy is sized so that, even at its slippage limit and with the rent for the escrow's
 *   token account, escrow cannot spend more than was committed.
 * - What was received and what was spent are read from the chain, not assumed.
 */
import { NATIVE } from "../constants";
import { randomBytes, toHex } from "../bytes";
import { settings } from "./env";
import { ring } from "./ring";
import { connection } from "./solana";
import { save, state, type SealedWindow } from "./store";

/** The most one window may raise, in lamports. The local copy of pump.fun's curve completes at about 0.85 SOL. */
export const WINDOW_CAP_LAMPORTS = 500_000_000n;
/** The least a window must hold to launch: below this the buy would be smaller than its own costs. */
export const WINDOW_MIN_LAMPORTS = 10_000_000n;
/** Set aside from the pool for the rent of escrow's token account for the new coin. */
export const RENT_RESERVE_LAMPORTS = 2_200_000n;
export const LONGEST_WINDOW_HOURS = 72;

export function assertWindowsOn(): void {
  if (!settings().features.sealedWindow) throw new Error("the sealed launch window is switched off");
}
const potOf = (id: string): string => `window:${id}`;
const big = (value: string | undefined): bigint => BigInt(value ?? "0");
export const totalOf = (window: SealedWindow): bigint => Object.values(window.commitments).reduce((sum, amount) => sum + BigInt(amount), 0n);

export function windowFor(id: string): SealedWindow {
  const found = state().windows.find((candidate) => candidate.id === id);
  if (!found) throw new Error("that window does not exist");
  return found;
}

/** A launch that can no longer land (its blockhash has expired and the coin does not exist) unlocks the window. */
export async function refresh(window: SealedWindow, coinExists: (mint: string) => Promise<boolean>): Promise<void> {
  if (window.status !== "launching" || !window.launching) return;
  if ((await connection().getBlockHeight("confirmed")) <= window.launching.lastValidBlockHeight) return;
  if (await coinExists(window.launching.mint)) return; // it landed: settlement will finish the job
  window.status = "open";
  delete window.launching;
  save();
}

export const windows = {
  open(creator: string, details: { name: string; symbol: string; description: string; hours: number }, now = Date.now()): SealedWindow {
    assertWindowsOn();
    const window: SealedWindow = {
      id: toHex(randomBytes(8)),
      creator,
      ...details,
      openedAt: now,
      closesAt: now + details.hours * 3_600_000,
      status: "open",
      commitments: {},
    };
    state().windows.push(window);
    save();
    return window;
  },

  /** Moves SOL from a Ring balance into the window. Allowed until the window closes. */
  commit(id: string, wallet: string, lamports: bigint, now = Date.now()): SealedWindow {
    assertWindowsOn();
    const window = windowFor(id);
    if (window.status !== "open")
      throw new Error(window.status === "launching" ? "the window is launching: nothing can be added now" : `the window is ${window.status}`);
    if (now >= window.closesAt) throw new Error("the window has closed to new commitments");
    if (lamports <= 0n) throw new Error("the amount must be above zero");
    if (totalOf(window) + lamports > WINDOW_CAP_LAMPORTS) throw new Error("that would take the window over its limit");
    ring.moveBetween(wallet, potOf(id), NATIVE, lamports);
    window.commitments[wallet] = (big(window.commitments[wallet]) + lamports).toString();
    ring.note({ kind: "window", public: { wallet, window: id }, sealed: { did: "committed", coin: NATIVE, amount: lamports.toString() }, parties: [wallet] });
    save();
    return window;
  },

  /** Takes a wallet's whole commitment back, any time before a launch is under way. */
  uncommit(id: string, wallet: string): SealedWindow {
    assertWindowsOn();
    const window = windowFor(id);
    if (window.status === "launching") throw new Error("the window is launching: nothing can be taken back until that is settled");
    if (window.status !== "open") throw new Error(`the window is ${window.status}`);
    const mine = big(window.commitments[wallet]);
    if (mine <= 0n) throw new Error("you have nothing committed to this window");
    refund(window, wallet, mine);
    save();
    return window;
  },

  /** The creator calls it off. Everything committed goes back. */
  cancel(id: string, creator: string): SealedWindow {
    assertWindowsOn();
    const window = windowFor(id);
    if (window.creator !== creator) throw new Error("that is not your window");
    if (window.status === "launching") throw new Error("the window is launching: it cannot be cancelled until that is settled");
    if (window.status !== "open") throw new Error(`the window is already ${window.status}`);
    for (const [wallet, amount] of Object.entries(window.commitments)) refund(window, wallet, BigInt(amount));
    window.status = "cancelled";
    save();
    return window;
  },

  /** Locks the window for a launch transaction that is about to be handed to the creator to sign. */
  lockForLaunch(id: string, creator: string, mint: string, lastValidBlockHeight: number, now = Date.now()): { window: SealedWindow; total: bigint } {
    assertWindowsOn();
    const window = windowFor(id);
    if (window.creator !== creator) throw new Error("that is not your window");
    if (window.status !== "open")
      throw new Error(window.status === "launching" ? "a launch of this window is already under way" : `the window is ${window.status}`);
    if (now < window.closesAt) throw new Error("the window is still open to commitments: it can launch once it has closed");
    const total = totalOf(window);
    if (total < WINDOW_MIN_LAMPORTS) throw new Error("too little is committed to launch. Cancel the window to return it.");
    window.status = "launching";
    window.launching = { mint, lastValidBlockHeight };
    save();
    return { window, total };
  },

  /**
   * After the launch has landed: shares out the coins escrow received and returns the SOL it did not spend.
   * `received` and `spent` are what the chain recorded. Shares are rounded down; the few base units left over
   * by rounding go to the largest committer, so that every unit escrow holds is owed to someone.
   */
  fill(window: SealedWindow, mint: string, received: bigint, spent: bigint, signature: string): void {
    const total = totalOf(window);
    if (spent > total) throw new Error("the launch spent more than was committed"); // cannot happen by construction; refuse rather than invent money
    const leftover = total - spent;
    const committers = Object.entries(window.commitments)
      .map(([wallet, amount]) => ({ wallet, amount: BigInt(amount) }))
      .sort((a, b) => (a.amount === b.amount ? a.wallet.localeCompare(b.wallet) : a.amount > b.amount ? -1 : 1));
    let coinsLeft = received;
    let solLeft = leftover;
    const shares = committers.map(({ wallet, amount }) => {
      const coins = (received * amount) / total;
      const sol = (leftover * amount) / total;
      coinsLeft -= coins;
      solLeft -= sol;
      return { wallet, coins, sol };
    });
    shares[0]!.coins += coinsLeft;
    shares[0]!.sol += solLeft;
    // The window's ledger account is emptied: what was spent has left escrow on-chain, the rest is handed back.
    ring.burn(potOf(window.id), NATIVE, spent);
    for (const share of shares) {
      if (share.sol > 0n) ring.moveBetween(potOf(window.id), share.wallet, NATIVE, share.sol);
      if (share.coins > 0n) ring.mint(share.wallet, mint, share.coins);
      ring.note({
        kind: "window",
        public: { wallet: share.wallet, window: window.id },
        sealed: { did: "filled", coin: mint, amount: share.coins.toString(), returned: share.sol.toString() },
        parties: [share.wallet],
        signature,
      });
    }
    window.status = "launched";
    window.mint = mint;
    window.signature = signature;
    window.commitments = {};
    delete window.launching;
    save();
  },
};

function refund(window: SealedWindow, wallet: string, amount: bigint): void {
  ring.moveBetween(potOf(window.id), wallet, NATIVE, amount);
  delete window.commitments[wallet];
  ring.note({
    kind: "window",
    public: { wallet, window: window.id },
    sealed: { did: "took back", coin: NATIVE, amount: amount.toString() },
    parties: [wallet],
  });
}
