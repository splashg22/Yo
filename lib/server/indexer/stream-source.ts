/**
 * The chain as a stream of transactions, turned into what the indexer reads.
 *
 * A stream (a websocket subscription, or a gRPC one) hands over single transactions as they are confirmed. It
 * has no blocks. The indexer is built on blocks: it applies one at a time, in order, each in one database step.
 * This is the join: transactions are gathered by slot, and a slot is closed into a block a few slots after the
 * chain has moved past it. A trade is announced to the pages the moment it arrives (the indexer's early
 * notice); it is stored when its slot closes.
 *
 * What a stream decides, this file does not: which transactions arrive is the stream's filter (new coins and the
 * coins being followed on the cheapest plan; everything on a full stream). Moving between them is a setting.
 *
 * What is different from blocks read through an RPC, said plainly:
 * - A block here holds only the transactions the stream delivered, and its hash is made up from its slot. So a
 *   reorganisation of confirmed blocks, which is rare, would not be noticed. The RPC source notices.
 * - A transaction that arrives after its slot was closed is put in the next block instead. It is stored once, in
 *   order of arrival, with a slot a little later than its own. `late` counts them.
 * - When the stream drops, nothing is closed until it is back and what was missed has been read (`catchUp`).
 *   If more was missed than can be read back, that is said (`gaps`), not hidden.
 */
import { txOf, type RawTx } from "./rpc-source";
import type { ChainBlock, ChainSource, ChainTx, EarlyTx } from "./types";

/** One transaction as a stream delivers it. */
export interface StreamTx {
  slot: number;
  /** Seconds since 1970, if the stream says; otherwise the moment of arrival is used. */
  time?: number;
  raw: RawTx;
}
export interface StreamHandlers {
  tx(tx: StreamTx): void;
  /** The chain has reached this slot. */
  slot(slot: number): void;
  /** The stream has dropped. Nothing more arrives until `up`. */
  down(reason: string): void;
  /** The stream is back. `catchUp` is called before anything else is trusted. */
  up(): void;
}
/** Where transactions come from. One implementation per provider; a recording, for tests. */
export interface TxStream {
  open(handlers: StreamHandlers): void;
  /**
   * Everything that was missed while the stream was down, oldest first. `complete` is false if more was missed
   * than could be read back.
   */
  catchUp(): Promise<{ txs: StreamTx[]; complete: boolean }>;
  /** The accounts whose transactions are wanted, beyond what the stream always carries. May be called at any time. */
  follow(accounts: string[]): void;
  close(): void;
}

/** A slot is closed once the chain is this many slots past it: confirmed transactions for it have stopped arriving by then. */
const CLOSE_AFTER_SLOTS = 3;
/** Signatures remembered, so a transaction delivered twice (a reconnect, a backfill that overlaps) is taken once. */
const REMEMBERED = 200_000;

export class StreamSource implements ChainSource {
  readonly kind = "stream" as const;
  private readonly gathering = new Map<number, { time: number; txs: ChainTx[] }>();
  private readonly blocks = new Map<number, ChainBlock>();
  private readonly seen = new Set<string>();
  private tip = 0;
  private tipHash = "stream:start";
  /** Every slot up to this one is closed for good: nothing more will be put in a block at or below it. */
  private horizon = 0;
  private chainSlot = 0;
  private isDown = true;
  private downBecause = "the stream has not opened yet";
  private catching: Promise<void> | undefined;
  private readonly slotListeners = new Set<() => void>();
  private readonly earlyListeners = new Set<(tx: EarlyTx) => void>();
  /** Transactions that arrived after their slot had been closed. */
  late = 0;
  /** Times the stream came back with more missed than could be read. Each is a hole in what is stored. */
  gaps = 0;
  /** Transactions delivered more than once and taken once. */
  repeats = 0;

  constructor(
    private readonly stream: TxStream,
    private readonly now: () => number = () => Date.now(),
  ) {
    stream.open({
      tx: (tx) => this.take(tx),
      slot: (slot) => this.reached(slot),
      down: (reason) => {
        this.isDown = true;
        this.downBecause = reason;
      },
      up: () => {
        // Nothing is closed, and the indexer is told nothing new, until what was missed has been put in its place.
        this.catching = this.stream
          .catchUp()
          .then(({ txs, complete }) => {
            if (!complete) this.gaps += 1;
            for (const tx of txs) this.take(tx);
          })
          .catch((error: unknown) => {
            this.gaps += 1;
            this.downBecause = `what was missed could not be read: ${error instanceof Error ? error.message : String(error)}`;
          })
          .finally(() => {
            this.isDown = false;
            this.catching = undefined;
            this.seal();
          });
      },
    });
  }

  /** The accounts to follow beyond what the stream always carries: one per coin being followed trade by trade. */
  follow(accounts: string[]): void {
    this.stream.follow(accounts);
  }
  /** Lets go of the stream. */
  close(): void {
    this.stream.close();
  }
  /** True while the stream is down or what it missed is still being read: the figures are not live. */
  get down(): boolean {
    return this.isDown;
  }

  private take(tx: StreamTx): void {
    const signature = tx.raw.transaction.signatures[0];
    if (!signature) return;
    if (this.seen.has(signature)) return void (this.repeats += 1);
    this.seen.add(signature);
    if (this.seen.size > REMEMBERED) {
      // Sets keep insertion order: the oldest go first.
      let over = this.seen.size - REMEMBERED;
      for (const old of this.seen) {
        if (over-- <= 0) break;
        this.seen.delete(old);
      }
    }
    // A slot already closed cannot be reopened: the indexer has moved past it. The transaction goes in the next one.
    let slot = tx.slot;
    if (slot <= this.horizon) {
      slot = this.horizon + 1;
      this.late += 1;
    }
    let bucket = this.gathering.get(slot);
    if (!bucket) this.gathering.set(slot, (bucket = { time: tx.time ?? Math.floor(this.now() / 1000), txs: [] }));
    const decoded = txOf(tx.raw, bucket.txs.length);
    if (!decoded) return;
    bucket.txs.push(decoded);
    if (decoded.events.length > 0) for (const listener of this.earlyListeners) listener({ slot, signature, events: decoded.events });
    if (slot > this.chainSlot) this.reached(slot);
  }
  private reached(slot: number): void {
    if (slot <= this.chainSlot) return;
    this.chainSlot = slot;
    this.seal();
  }
  /** Closes every gathered slot the chain is far enough past, oldest first, and tells the indexer. */
  private seal(): void {
    if (this.isDown) return;
    const horizon = Math.max(this.horizon, this.chainSlot - CLOSE_AFTER_SLOTS);
    if (horizon === this.horizon) return;
    const ready = [...this.gathering.keys()].filter((slot) => slot <= horizon).sort((a, b) => a - b);
    this.horizon = horizon;
    for (const slot of ready) {
      const bucket = this.gathering.get(slot)!;
      this.gathering.delete(slot);
      if (bucket.txs.length === 0) continue;
      const hash = `stream:${slot}`;
      this.blocks.set(slot, { slot, hash, parentSlot: this.tip, parentHash: this.tipHash, time: bucket.time, txs: bucket.txs });
      this.tip = slot;
      this.tipHash = hash;
    }
    // Blocks the indexer has long since read are let go.
    if (this.blocks.size > 4_000) for (const slot of [...this.blocks.keys()].sort((a, b) => a - b).slice(0, this.blocks.size - 2_000)) this.blocks.delete(slot);
    for (const listener of this.slotListeners) listener();
  }
  /** Closes everything gathered, whatever the chain's slot. For the end of a recording, and for shutting down. */
  flush(): void {
    this.chainSlot = Math.max(this.chainSlot, ...this.gathering.keys()) + CLOSE_AFTER_SLOTS;
    this.seal();
  }
  /** Resolves when nothing missed is still being read. */
  async settled(): Promise<void> {
    await this.catching;
  }

  /** An answer, or a refusal while the stream is down: what is held then is not the chain as it is now. */
  private answer<Answer>(make: () => Answer): Promise<Answer> {
    return this.isDown ? Promise.reject(new Error(`the stream is down: ${this.downBecause}`)) : Promise.resolve(make());
  }
  head(): Promise<number> {
    return this.answer(() => this.horizon);
  }
  slots(from: number, to: number): Promise<number[]> {
    return this.answer(() => [...this.blocks.keys()].filter((slot) => slot >= from && slot <= to).sort((a, b) => a - b));
  }
  block(slot: number): Promise<ChainBlock | null> {
    return this.answer(() => this.blocks.get(slot) ?? null);
  }
  watch(onSlot: () => void, onEarly: (tx: EarlyTx) => void): () => void {
    this.slotListeners.add(onSlot);
    this.earlyListeners.add(onEarly);
    return () => {
      this.slotListeners.delete(onSlot);
      this.earlyListeners.delete(onEarly);
    };
  }
}
