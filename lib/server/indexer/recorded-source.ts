/**
 * A stretch of a real chain, recorded once and played back: the same blocks, in the same order, as often as wanted.
 * It is how the terminal's data layer is built and tested against mainnet's real volume and shapes without a paid
 * stream, and without anything on mainnet being asked to do anything.
 *
 * A recording is gzipped lines of JSON, one block a line, cut down by `trimRawBlock` (scripts/record-chain.ts makes
 * one). Played back, blocks become available one at a time (`release`), so a test decides when the chain "moves",
 * when the source stops answering, and when it comes back.
 *
 * It is a source of data that really happened. It is never shown as live: the server uses it only when a test or a
 * script hands it over, and what it holds is old by the time it is played.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { blockFromRaw, type RawBlock } from "./rpc-source";
import type { ChainBlock, ChainSource, EarlyTx } from "./types";

interface RecordedLine extends RawBlock {
  slot: number;
}

export class RecordedSource implements ChainSource {
  private readonly blocks = new Map<number, RecordedLine>();
  private readonly order: number[];
  private released = 0;
  private readonly slotListeners = new Set<() => void>();
  private readonly earlyListeners = new Set<(tx: EarlyTx) => void>();
  /** Set to make every read fail, as an RPC that has stopped answering does. */
  down = false;
  /** When true, a released block's trades are announced ahead of the block being read, as the log subscription does. */
  announce = false;
  /** Reads asked of it, for tests that hold the indexer to a budget. */
  reads = 0;

  constructor(path: string) {
    const lines = gunzipSync(readFileSync(path)).toString("utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      const block = JSON.parse(line) as RecordedLine;
      this.blocks.set(block.slot, block);
    }
    this.order = [...this.blocks.keys()].sort((a, b) => a - b);
    if (this.order.length === 0) throw new Error(`the recording at ${path} holds no block`);
  }

  /** How many blocks the recording holds, and the first and last slot. */
  get length(): number {
    return this.order.length;
  }
  get firstSlot(): number {
    return this.order[0]!;
  }
  get lastSlot(): number {
    return this.order[this.order.length - 1]!;
  }
  /** The newest slot made available so far, or one before the recording if none has been. */
  get tip(): number {
    return this.released === 0 ? this.firstSlot - 1 : this.order[this.released - 1]!;
  }
  /** Seconds of chain time the recording covers. */
  get seconds(): number {
    return (this.blocks.get(this.lastSlot)!.blockTime ?? 0) - (this.blocks.get(this.firstSlot)!.blockTime ?? 0);
  }
  /** Every block of the recording, decoded, whether released or not: what a test compares the indexer's result with. */
  all(): ChainBlock[] {
    return this.order.map((slot) => blockFromRaw(slot, this.blocks.get(slot)!));
  }

  /** Makes the next `count` blocks available, as if the chain had just produced them. Returns the new tip. */
  release(count = 1): number {
    const before = this.released;
    this.released = Math.min(this.order.length, this.released + count);
    if (this.announce)
      for (const slot of this.order.slice(before, this.released))
        for (const tx of blockFromRaw(slot, this.blocks.get(slot)!).txs)
          if (tx.events.some((event) => event.kind === "trade"))
            for (const listener of this.earlyListeners) listener({ slot, signature: tx.signature, events: tx.events });
    if (this.released > before) for (const listener of this.slotListeners) listener();
    return this.tip;
  }
  get finished(): boolean {
    return this.released === this.order.length;
  }

  private check(): void {
    this.reads += 1;
    if (this.down) throw new Error("fetch failed");
  }
  head(): Promise<number> {
    this.check();
    return Promise.resolve(this.tip);
  }
  slots(from: number, to: number): Promise<number[]> {
    this.check();
    return Promise.resolve(this.order.slice(0, this.released).filter((slot) => slot >= from && slot <= to));
  }
  block(slot: number): Promise<ChainBlock | null> {
    this.check();
    const found = slot <= this.tip ? this.blocks.get(slot) : undefined;
    return Promise.resolve(found ? blockFromRaw(slot, found) : null);
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
