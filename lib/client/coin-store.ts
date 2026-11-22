/**
 * Everything one coin's trading screen shows, kept in one place outside React: the coin's figures, its newest
 * trades, its largest holders, and its candles for whichever timeframes are on screen.
 *
 * It starts from a snapshot (plain requests), then listens to the live channels from the frame numbers that
 * came with the snapshot, so nothing between the two is missed. The chart reads it directly on every frame;
 * the tables re-render only when what they show has changed.
 */
import type { CoinView, HolderView, TradeView } from "../contract";
import { api } from "./api";
import { subscribe, type LiveEvent } from "./live";

export type CandleRow = number[]; // [time s, open, high, low, close, volume lamports, trades, buys]
const TRADES_KEPT = 400;

export class Series {
  rows: CandleRow[] = [];
  /** Counts every change, so the chart knows when to draw again. */
  version = 0;
  loading = false;
  /** No candles older than the ones held exist. */
  complete = false;
  private stop: (() => void) | undefined;
  constructor(
    readonly mint: string,
    readonly tf: number,
  ) {}

  async start(): Promise<void> {
    await this.snapshot();
  }
  private async snapshot(): Promise<void> {
    this.stop?.();
    const answer = await api("coin/candles", { mint: this.mint, tf: this.tf, limit: 600 });
    this.rows = answer.candles;
    this.complete = answer.candles.length < 600;
    this.version += 1;
    this.stop = subscribe(`k:${this.mint}:${this.tf}`, answer.seq, {
      events: (events) => {
        for (const [kind, row] of events) if (kind === "k") this.put(row as CandleRow);
      },
      reset: () => void this.snapshot().catch(() => undefined),
    });
  }
  private put(row: CandleRow): void {
    const last = this.rows[this.rows.length - 1];
    if (last && last[0] === row[0]) this.rows[this.rows.length - 1] = row;
    else if (!last || row[0]! > last[0]!) this.rows.push(row);
    else {
      // A candle from the past was corrected: find it and replace it.
      const index = this.rows.findIndex((candidate) => candidate[0] === row[0]);
      if (index >= 0) this.rows[index] = row;
    }
    this.version += 1;
  }
  /** A trade heard before its block: the newest candle's close (and high or low) follows it at once. The stored candle arrives a moment later and replaces this. */
  tick(price: number, seconds: number): void {
    const bucket = seconds - (seconds % this.tf);
    const last = this.rows[this.rows.length - 1];
    if (last && last[0] === bucket) {
      this.rows[this.rows.length - 1] = [bucket, last[1]!, Math.max(last[2]!, price), Math.min(last[3]!, price), price, last[5]!, last[6]!, last[7]!];
    } else if (!last || bucket > last[0]!) {
      const open = last ? last[4]! : price;
      this.rows.push([bucket, open, Math.max(open, price), Math.min(open, price), price, 0, 0, 0]);
    } else return;
    this.version += 1;
  }
  /** Fetches the candles before the oldest held. Called when the chart is dragged back to its left edge. */
  async older(): Promise<void> {
    if (this.loading || this.complete || this.rows.length === 0) return;
    this.loading = true;
    try {
      const answer = await api("coin/candles", { mint: this.mint, tf: this.tf, before: this.rows[0]![0]!, limit: 600 });
      if (answer.candles.length < 600) this.complete = true;
      this.rows = [...answer.candles, ...this.rows];
      this.version += 1;
    } finally {
      this.loading = false;
    }
  }
  close(): void {
    this.stop?.();
  }
}

export class CoinStore {
  coin: CoinView | null = null;
  problem = "";
  /** Newest first. */
  trades: TradeView[] = [];
  holders = new Map<string, HolderView>();
  supply = 0n;
  private ranked: HolderView[] | undefined;
  /** The holders, largest first. The same list is handed back until a holder changes. */
  holderList = (): HolderView[] =>
    (this.ranked ??= [...this.holders.values()].sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : BigInt(b.amount) < BigInt(a.amount) ? -1 : 0)));
  /** Bumped on every change to the figures, the trades or the holders. */
  version = 0;
  tradesVersion = 0;
  holdersVersion = 0;
  private readonly listeners = new Set<() => void>();
  private readonly series = new Map<number, Series>();
  private stop: (() => void) | undefined;
  private notifying = false;
  closed = false;

  constructor(readonly mint: string) {}

  async start(): Promise<void> {
    try {
      const [coin, trades, holders] = await Promise.all([
        api("coin", { mint: this.mint }),
        api("coin/trades", { mint: this.mint, limit: 200 }),
        api("coin/holders", { mint: this.mint }),
      ]);
      if (this.closed) return;
      this.coin = coin;
      this.trades = trades.trades;
      this.holders = new Map(holders.holders.map((holder) => [holder.owner, holder]));
      this.ranked = undefined;
      this.supply = BigInt(holders.supply);
      this.problem = "";
      this.stop?.();
      // The three answers were taken a moment apart; listening from the earliest of their frame numbers repeats a little rather than missing anything.
      this.stop = subscribe(`coin:${this.mint}`, Math.min(coin.seq, trades.seq, holders.seq), {
        events: (events) => this.apply(events),
        reset: () => void this.start(),
      });
    } catch (error) {
      this.problem = error instanceof Error ? error.message : String(error);
    }
    this.changed();
  }

  private apply(events: LiveEvent[]): void {
    for (const event of events) {
      const kind = event[0];
      if (kind === "t" || kind === "e") {
        const trade = event[1] as TradeView;
        const index = this.trades.findIndex((known) => known.s === trade.s && known.i === trade.i);
        // The list is replaced, never changed in place, so whatever shows it can tell that it changed.
        if (index >= 0) {
          // Already shown: either it was heard early and is now confirmed, or it is a repeat.
          if (kind === "t") this.trades = this.trades.map((known, at) => (at === index ? trade : known));
        } else this.trades = [trade, ...this.trades].slice(0, TRADES_KEPT);
        if (kind === "e") for (const series of this.series.values()) series.tick(trade.p, Math.floor(trade.t / 1000));
        this.tradesVersion += 1;
      } else if (kind === "m" && this.coin) {
        this.coin = { ...this.coin, ...(event[1] as Partial<CoinView>) };
      } else if (kind === "h") {
        const [, owner, amount] = event as [string, string, string];
        const known = this.holders.get(owner);
        if (amount === "0") this.holders.delete(owner);
        else this.holders.set(owner, { owner, amount, tags: known?.tags ?? [] });
        this.holdersVersion += 1;
        this.ranked = undefined;
      }
    }
    this.changed();
  }
  private changed(): void {
    this.version += 1;
    if (this.notifying) return;
    // Several events in one frame cause one re-render.
    this.notifying = true;
    queueMicrotask(() => {
      this.notifying = false;
      for (const listener of this.listeners) listener();
    });
  }

  /** The candles for a timeframe, started on first use and kept while the screen is open. */
  candles(tf: number): Series {
    let found = this.series.get(tf);
    if (!found) {
      found = new Series(this.mint, tf);
      this.series.set(tf, found);
      void found.start().catch(() => undefined);
    }
    return found;
  }
  /** Shows a trade the person just made, before the chain has confirmed it, so the screen answers the click at once. */
  optimistic(trade: TradeView): void {
    if (this.trades.some((known) => known.s === trade.s)) return;
    this.trades = [trade, ...this.trades];
    this.tradesVersion += 1;
    this.changed();
  }
  /** Takes back an optimistic trade that did not land. */
  withdraw(signature: string): void {
    const before = this.trades.length;
    this.trades = this.trades.filter((trade) => !(trade.s === signature && trade.early));
    if (this.trades.length !== before) {
      this.tradesVersion += 1;
      this.changed();
    }
  }
  listen = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  close(): void {
    this.closed = true;
    this.stop?.();
    for (const series of this.series.values()) series.close();
    this.listeners.clear();
  }
}
