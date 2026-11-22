/**
 * A recorded stretch of mainnet, delivered as a stream delivers it: one transaction at a time, with the stream's
 * own failings on demand (a drop, a repeat, a late arrival). For building and testing the stream source without a
 * paid stream. Like every recording here it is old data that really happened, and is never shown as live.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { RawBlock } from "./rpc-source";
import type { StreamHandlers, StreamTx, TxStream } from "./stream-source";

interface RecordedLine extends RawBlock {
  slot: number;
}

export class RecordedTxStream implements TxStream {
  private readonly lines: RecordedLine[];
  private handlers: StreamHandlers | undefined;
  private at = 0;
  private connected = false;
  private missed: StreamTx[] = [];
  /** The most the stream will read back after a drop. More than this missed, and it says the catch-up is not complete. */
  backfillLimit = Infinity;
  followed: string[] = [];

  constructor(path: string) {
    this.lines = gunzipSync(readFileSync(path))
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RecordedLine)
      .sort((a, b) => a.slot - b.slot);
  }
  get length(): number {
    return this.lines.length;
  }
  get finished(): boolean {
    return this.at >= this.lines.length;
  }
  private txsOf(line: RecordedLine): StreamTx[] {
    return line.transactions.map((raw) => ({ slot: line.slot, ...(line.blockTime === null ? {} : { time: line.blockTime }), raw }));
  }

  open(handlers: StreamHandlers): void {
    this.handlers = handlers;
  }
  /** The stream connects. */
  connect(): void {
    this.connected = true;
    this.handlers?.up();
  }
  /** The stream drops. What the chain does meanwhile is not delivered until it is back. */
  drop(reason = "the connection closed"): void {
    this.connected = false;
    this.handlers?.down(reason);
  }
  /**
   * The chain produces the next `count` blocks. Connected, their transactions are delivered; dropped, they are missed.
   * `shape` can make the delivery misbehave as a real stream does.
   */
  play(count = 1, shape: { repeatEvery?: number; holdBack?: (tx: StreamTx, index: number) => boolean } = {}): StreamTx[] {
    const held: StreamTx[] = [];
    for (const line of this.lines.slice(this.at, this.at + count)) {
      const txs = this.txsOf(line);
      if (!this.connected) {
        this.missed.push(...txs);
        continue;
      }
      txs.forEach((tx, index) => {
        if (shape.holdBack?.(tx, index)) return void held.push(tx);
        this.handlers!.tx(tx);
        if (shape.repeatEvery && index % shape.repeatEvery === 0) this.handlers!.tx(tx);
      });
      this.handlers!.slot(line.slot);
    }
    this.at = Math.min(this.lines.length, this.at + count);
    return held;
  }
  /** Delivers transactions out of their time: held back earlier, arriving now. */
  deliver(txs: StreamTx[]): void {
    for (const tx of txs) this.handlers?.tx(tx);
  }
  catchUp(): Promise<{ txs: StreamTx[]; complete: boolean }> {
    const all = this.missed;
    this.missed = [];
    // What cannot be read back is the oldest part: a backfill reads from the present backwards until its limit.
    const txs = all.length > this.backfillLimit ? all.slice(all.length - this.backfillLimit) : all;
    return Promise.resolve({ txs, complete: txs.length === all.length });
  }
  follow(accounts: string[]): void {
    this.followed = accounts;
  }
  close(): void {
    this.connected = false;
  }
}
