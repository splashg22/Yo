/** The sealed launch window. Every operation refuses unless FEATURE_SEALED_WINDOW=on. See ../windows.ts. */
import type { WindowView } from "../../contract";
import { PICTURE_MAX_BYTES, storeCoinDetails } from "../pictures";
import { reconcile } from "../settle";
import { durable, save, state, type SealedWindow } from "../store";
import { buildWindowLaunch } from "../transactions";
import { addressOf, amountOf, plainText, text } from "../validate";
import { LONGEST_WINDOW_HOURS, WINDOW_CAP_LAMPORTS, WINDOW_MIN_LAMPORTS, assertWindowsOn, refresh, totalOf, windowFor, windows } from "../windows";
import { signedBody } from "./ring";
import type { Handlers } from "./types";

/** What anyone may see of a window: who opened it, when it closes, how many committed and how much in total. Not who committed what. */
const view = (window: SealedWindow): WindowView => ({
  id: window.id,
  creator: window.creator,
  name: window.name,
  symbol: window.symbol,
  description: window.description,
  openedAt: window.openedAt,
  closesAt: window.closesAt,
  status: window.status,
  committers: Object.keys(window.commitments).length,
  totalLamports: totalOf(window).toString(),
  mint: window.mint,
  signature: window.signature,
});
const idOf = (value: unknown): string => text(value, "window", 40);

export const windowOperations: Handlers<
  "window/list" | "window/mine" | "window/open" | "window/commit" | "window/uncommit" | "window/cancel" | "window/launch/build"
> = {
  "window/list": async () => {
    assertWindowsOn();
    for (const window of state().windows) await refresh(window, reconcile);
    return {
      windows: [...state().windows].reverse().map(view),
      limits: { capLamports: WINDOW_CAP_LAMPORTS.toString(), minimumLamports: WINDOW_MIN_LAMPORTS.toString(), longestHours: LONGEST_WINDOW_HOURS },
    };
  },

  "window/mine": (input) => {
    assertWindowsOn();
    const { wallet } = signedBody("window/mine", input);
    const commitments: Record<string, string> = {};
    for (const window of state().windows) if (window.commitments[wallet]) commitments[window.id] = window.commitments[wallet];
    return { commitments };
  },

  "window/open": (input) => {
    assertWindowsOn();
    const body = signedBody("window/open", input);
    const symbol = plainText(body.symbol, "ticker", 10).toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(symbol)) throw new Error("the ticker must be 1 to 10 letters or digits");
    const hours = Number(body.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > LONGEST_WINDOW_HOURS)
      throw new Error(`a window stays open for 1 to ${LONGEST_WINDOW_HOURS} whole hours`);
    const description = body.description === undefined || body.description === "" ? "" : plainText(body.description, "description", 280);
    return { window: view(windows.open(body.wallet, { name: plainText(body.name, "coin name", 32), symbol, description, hours })) };
  },

  "window/commit": (input) => {
    assertWindowsOn();
    const body = signedBody("window/commit", input);
    return { window: view(windows.commit(idOf(body.id), body.wallet, amountOf(body.lamports, "amount"))) };
  },

  "window/uncommit": async (input) => {
    assertWindowsOn();
    const body = signedBody("window/uncommit", input);
    await refresh(windowFor(idOf(body.id)), reconcile);
    return { window: view(windows.uncommit(idOf(body.id), body.wallet)) };
  },

  "window/cancel": async (input) => {
    assertWindowsOn();
    const body = signedBody("window/cancel", input);
    await refresh(windowFor(idOf(body.id)), reconcile);
    return { window: view(windows.cancel(idOf(body.id), body.wallet)) };
  },

  "window/launch/build": async (input) => {
    assertWindowsOn();
    const body = signedBody("window/launch/build", input);
    const mint = addressOf(body.mint, "new coin's address");
    const window = windowFor(idOf(body.id));
    await refresh(window, reconcile);
    // Locked before anything is awaited, so nothing can be added or taken back while the transaction is being made.
    const { total, lock } = windows.lockForLaunch(window.id, body.wallet, mint);
    try {
      const picture = body.picture === undefined || body.picture === "" ? undefined : text(body.picture, "picture", Math.ceil((PICTURE_MAX_BYTES * 4) / 3) + 4);
      const details = await storeCoinDetails({ name: window.name, symbol: window.symbol, description: window.description, picture });
      const built = await buildWindowLaunch({ wallet: body.wallet, mint, name: window.name, symbol: window.symbol, uri: details.uri, total });
      // Recorded, and stored, before the transaction leaves this server: it is recognised by escrow's signature when it lands.
      windows.launchBuilt(window, lock, built.escrowSignature, built.lastValidBlockHeight);
      state().pendingLaunches[mint] = {
        wallet: body.wallet,
        name: window.name,
        symbol: window.symbol,
        at: Date.now(),
        ...(details.image ? { image: details.image } : {}),
      };
      save();
      await durable();
      return { transaction: built.transaction };
    } catch (error) {
      windows.launchNotBuilt(window, lock);
      throw error;
    }
  },
};
