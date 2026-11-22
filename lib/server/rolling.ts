/**
 * How much each coin traded lately, kept in memory by the minute, so that "volume in the last hour" and a
 * trending list cost no database read. One small bucket per coin per minute in which it traded, for a day.
 */
export interface Window {
  /** Lamports traded. */
  volume: number;
  trades: number;
  buys: number;
}
export const WINDOWS = { m5: 300, h1: 3_600, h6: 21_600, h24: 86_400 } as const;
export type WindowKey = keyof typeof WINDOWS;
export const isWindowKey = (value: unknown): value is WindowKey => typeof value === "string" && Object.hasOwn(WINDOWS, value);
const DAY_MINUTES = 1_440;

export class Rolling {
  /** Per coin: minute (seconds since 1970 divided by 60) to what traded in it. */
  private readonly coins = new Map<string, Map<number, Window>>();

  add(mint: string, atSeconds: number, lamports: number, isBuy: boolean, trades = 1, buys = isBuy ? 1 : 0): void {
    let minutes = this.coins.get(mint);
    if (!minutes) this.coins.set(mint, (minutes = new Map<number, Window>()));
    const minute = Math.floor(atSeconds / 60);
    const bucket = minutes.get(minute);
    if (bucket) {
      bucket.volume += lamports;
      bucket.trades += trades;
      bucket.buys += buys;
    } else {
      minutes.set(minute, { volume: lamports, trades, buys });
      // Now and then, what is older than a day is let go.
      if (minutes.size > DAY_MINUTES + 60) for (const old of minutes.keys()) if (old < minute - DAY_MINUTES) minutes.delete(old);
    }
  }
  /** What a coin traded in the `seconds` up to `nowSeconds`. */
  window(mint: string, seconds: number, nowSeconds: number): Window {
    const total: Window = { volume: 0, trades: 0, buys: 0 };
    const minutes = this.coins.get(mint);
    if (!minutes) return total;
    const from = Math.floor((nowSeconds - seconds) / 60);
    const to = Math.floor(nowSeconds / 60);
    // Whichever is fewer: the minutes of the window, or the minutes the coin traded in.
    if (minutes.size <= to - from) {
      for (const [minute, bucket] of minutes) {
        if (minute <= from || minute > to) continue;
        total.volume += bucket.volume;
        total.trades += bucket.trades;
        total.buys += bucket.buys;
      }
    } else {
      for (let minute = from + 1; minute <= to; minute++) {
        const bucket = minutes.get(minute);
        if (!bucket) continue;
        total.volume += bucket.volume;
        total.trades += bucket.trades;
        total.buys += bucket.buys;
      }
    }
    return total;
  }
  drop(mint: string): void {
    this.coins.delete(mint);
  }
  /** The coins that traded most in a window, most first. */
  top(seconds: number, nowSeconds: number, limit: number): { mint: string; volume: number }[] {
    const ranked: { mint: string; volume: number }[] = [];
    for (const mint of this.coins.keys()) {
      const { volume } = this.window(mint, seconds, nowSeconds);
      if (volume > 0) ranked.push({ mint, volume });
    }
    return ranked.sort((a, b) => b.volume - a.volume).slice(0, limit);
  }
}
