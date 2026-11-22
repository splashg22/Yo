/**
 * Making a trade from the page, the fast way and the ordinary way, and what the person has chosen for their
 * trades (slippage, priority fee, preset amounts, one-click), kept in this browser.
 */
import type { BuiltTradeView, TxOutcomeView } from "../contract";
import { api, type Signer } from "./api";
import { sendOverLive, subscribe } from "./live";

export interface TradeSettings {
  /** Hundredths of a percent. */
  slippageBps: number;
  /** Lamports for the whole transaction, as a decimal string. "0": none. */
  priorityLamports: string;
  /** A press of an amount button trades at once, with no second press. */
  oneClick: boolean;
  /** The four buy buttons, in SOL, as the person typed them. */
  buys: [string, string, string, string];
}
export const DEFAULT_SETTINGS: TradeSettings = { slippageBps: 200, priorityLamports: "100000", oneClick: false, buys: ["0.01", "0.05", "0.1", "0.5"] };
export const SELL_SHARES = [25, 50, 75, 100] as const;
const SETTINGS_KEY = "ring.trade.settings";

export function loadSettings(): TradeSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<TradeSettings> | null;
    if (!stored) return DEFAULT_SETTINGS;
    const buys =
      Array.isArray(stored.buys) && stored.buys.length === 4 && stored.buys.every((value) => typeof value === "string" && /^\d*\.?\d+$/.test(value))
        ? stored.buys
        : DEFAULT_SETTINGS.buys;
    return {
      slippageBps:
        Number.isInteger(stored.slippageBps) && stored.slippageBps! >= 1 && stored.slippageBps! <= 5000 ? stored.slippageBps! : DEFAULT_SETTINGS.slippageBps,
      priorityLamports:
        typeof stored.priorityLamports === "string" && /^\d{1,9}$/.test(stored.priorityLamports) ? stored.priorityLamports : DEFAULT_SETTINGS.priorityLamports,
      oneClick: stored.oneClick === true,
      buys,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export function saveSettings(settings: TradeSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* a browser with no storage keeps the settings for this visit only */
  }
}

// ---- outcomes: how a sent transaction ended -------------------------------------------------

const waiting = new Map<string, (outcome: TxOutcomeView) => void>();
const listening = new Map<string, () => void>();
/** Listens to a wallet's own channel, where the server reports how each of its transactions ended. */
function listenTo(wallet: string): void {
  if (listening.has(wallet)) return;
  listening.set(
    wallet,
    subscribe(`wallet:${wallet}`, undefined, {
      events: (events) => {
        for (const [kind, body] of events) {
          if (kind !== "tx") continue;
          const outcome = body as TxOutcomeView;
          waiting.get(outcome.signature)?.(outcome);
        }
      },
      reset: () => undefined,
    }),
  );
}
/**
 * How a transaction this wallet sent ended: confirmed, failed or expired. The answer comes over the live
 * connection; a plain request asks as well, so a dropped connection does not leave the person waiting.
 */
export function outcomeOf(wallet: string, signature: string): Promise<TxOutcomeView> {
  listenTo(wallet);
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (outcome: TxOutcomeView): void => {
      if (done || outcome.state === "sent") return;
      done = true;
      waiting.delete(signature);
      resolve(outcome);
    };
    waiting.set(signature, finish);
    const ask = async (): Promise<void> => {
      for (let asked = 0; asked < 8 && !done; asked++) {
        const outcome = await api("tx/wait", { signature, ms: 20_000 });
        finish(outcome);
      }
      if (!done) reject(new Error("the transaction was sent but the chain has not confirmed it yet. Its receipt will show the result."));
    };
    ask().catch((error: unknown) => !done && reject(error instanceof Error ? error : new Error(String(error))));
  });
}

// ---- building and sending ------------------------------------------------------------------

export interface TradeRequest {
  wallet: string;
  mint: string;
  side: "buy" | "sell";
  /** Lamports for a buy, coin base units for a sell. */
  amount: bigint;
  settings: TradeSettings;
}
const settingsOf = (settings: TradeSettings) => ({ slippageBps: settings.slippageBps, priorityLamports: settings.priorityLamports });

export const buildTrade = (request: TradeRequest): Promise<BuiltTradeView> =>
  api("trade/build", { wallet: request.wallet, mint: request.mint, side: request.side, amount: request.amount.toString(), ...settingsOf(request.settings) });

/** Trades built ahead of the click, so that the click itself only has to sign and send. */
export interface Prepared {
  at: number;
  key: string;
  buys: Map<string, BuiltTradeView>;
  sells: Map<string, BuiltTradeView>;
}
/** Past this age a prepared trade's blockhash is too close to expiring to use. */
export const PREPARED_GOOD_FOR_MS = 40_000;
export async function prepareTrades(wallet: string, mint: string, settings: TradeSettings, buys: bigint[], sells: bigint[], key: string): Promise<Prepared> {
  const answer = await api("trade/prepare", {
    wallet,
    mint,
    buys: buys.map(String),
    sells: sells.filter((amount) => amount > 0n).map(String),
    ...settingsOf(settings),
  });
  const wanted = sells.filter((amount) => amount > 0n);
  return {
    at: Date.now(),
    key,
    buys: new Map(buys.flatMap((amount, index) => (answer.buys[index] ? [[amount.toString(), answer.buys[index]] as const] : []))),
    sells: new Map(wanted.flatMap((amount, index) => (answer.sells[index] ? [[amount.toString(), answer.sells[index]] as const] : []))),
  };
}

/**
 * Signs a built trade and hands it to the network. With `fast` it goes over the live connection and skips the
 * RPC's dry run, which is what makes one-click quick; otherwise it goes by an ordinary request, which is
 * checked first and refused with a reason before anything is sent.
 * Resolves as soon as the network has it, with the signature. `outcomeOf` says how it ended.
 */
export async function signAndSubmit(signer: Signer, built: BuiltTradeView, fast: boolean): Promise<string> {
  const signed = await signer.signTransaction(built.transaction);
  if (fast) return (await sendOverLive(signed)).signature;
  return (await api("tx/send", { transaction: signed })).signature;
}
