/**
 * A made-up chain, for tests and load tests only: coins on a constant-product curve, blocks made on demand,
 * and the ability to fork, so the indexer's handling of order, restarts and reorganisations can be proven
 * without waiting for a real chain to misbehave. Nothing here is ever shown as a real coin: the server
 * uses it only when a test hands it over.
 */
import bs58 from "bs58";
import { createHash } from "node:crypto";
import type { ChainBlock, ChainEvent, ChainSource, ChainTx, EarlyTx } from "./types";

interface Curve {
  creator: string;
  supply: bigint;
  virtualSol: bigint;
  virtualTokens: bigint;
  realSol: bigint;
  realTokens: bigint;
  complete: boolean;
}
interface Snapshot {
  curves: Map<string, Curve>;
  held: Map<string, bigint>;
}
const INITIAL = { supply: 1_000_000_000_000_000n, virtualSol: 30_000_000_000n, virtualTokens: 1_073_000_000_000_000n, realTokens: 793_100_000_000_000n };
const address = (label: string): string => bs58.encode(createHash("sha256").update(label).digest());

export class SimChain implements ChainSource {
  private readonly blocks = new Map<number, ChainBlock>();
  private readonly snapshots = new Map<number, Snapshot>();
  private curves = new Map<string, Curve>();
  private held = new Map<string, bigint>();
  private pending: ChainTx[] = [];
  private slot = 0;
  private tip = "genesis";
  private counter = 0;
  private branch = 0;
  private readonly slotListeners = new Set<() => void>();
  private readonly earlyListeners = new Set<(tx: EarlyTx) => void>();
  /** Seconds. Each block is stamped with it; tests move it to cross candle boundaries. */
  time = 1_800_000_000;
  /** When false, trades are not announced ahead of their block. */
  announce = true;
  /** Set to make every read fail, as a dead RPC would. */
  down = false;

  constructor() {
    this.snapshots.set(0, { curves: new Map(), held: new Map() });
  }

  static wallet = (label: string): string => address(`wallet:${label}`);
  static mint = (label: string): string => address(`mint:${label}`);
  curveOwner = (mint: string): string => address(`curve:${mint}`);

  private tx(events: ChainEvent[], balances: ChainTx["balances"]): ChainTx {
    const signature = bs58.encode(createHash("sha512").update(`tx:${this.branch}:${++this.counter}`).digest());
    const made: ChainTx = { signature, index: this.pending.length, events, balances };
    this.pending.push(made);
    if (this.announce && events.some((event) => event.kind === "trade"))
      for (const listener of this.earlyListeners) listener({ slot: this.slot + 1, signature, events });
    return made;
  }
  private balance(mint: string, owner: string, change: bigint): { mint: string; owner: string; amount: bigint } {
    const key = `${mint}|${owner}`;
    const amount = (this.held.get(key) ?? 0n) + change;
    if (amount < 0n) throw new Error("the made-up chain was asked to spend coins nobody has");
    this.held.set(key, amount);
    return { mint, owner, amount };
  }

  create(mint: string, creator: string, name = "Sim", symbol = "SIM"): string {
    this.curves.set(mint, {
      creator,
      supply: INITIAL.supply,
      virtualSol: INITIAL.virtualSol,
      virtualTokens: INITIAL.virtualTokens,
      realSol: 0n,
      realTokens: INITIAL.realTokens,
      complete: false,
    });
    return this.tx(
      [
        {
          kind: "create",
          mint,
          creator,
          name,
          symbol,
          uri: "",
          supply: INITIAL.supply,
          virtualSol: INITIAL.virtualSol,
          virtualTokens: INITIAL.virtualTokens,
          realTokens: INITIAL.realTokens,
        },
      ],
      [this.balance(mint, this.curveOwner(mint), INITIAL.supply)],
    ).signature;
  }
  /** A buy of `amount` lamports, or a sell of `amount` coin base units. Returns the signature and what the trade delivered. */
  trade(mint: string, wallet: string, side: "buy" | "sell", amount: bigint): { signature: string; sol: bigint; tokens: bigint } {
    const curve = this.curves.get(mint);
    if (!curve) throw new Error("no such made-up coin");
    const k = curve.virtualSol * curve.virtualTokens;
    let sol: bigint, tokens: bigint;
    if (side === "buy") {
      sol = amount;
      tokens = curve.virtualTokens - k / (curve.virtualSol + sol);
      if (tokens > curve.realTokens) tokens = curve.realTokens;
      curve.virtualSol += sol;
      curve.virtualTokens -= tokens;
      curve.realSol += sol;
      curve.realTokens -= tokens;
    } else {
      tokens = amount;
      sol = curve.virtualSol - k / (curve.virtualTokens + tokens);
      curve.virtualSol -= sol;
      curve.virtualTokens += tokens;
      curve.realSol -= sol;
      curve.realTokens += tokens;
    }
    const events: ChainEvent[] = [
      {
        kind: "trade",
        venue: "curve",
        mint,
        wallet,
        isBuy: side === "buy",
        sol,
        tokens,
        virtualSol: curve.virtualSol,
        virtualTokens: curve.virtualTokens,
        realSol: curve.realSol,
        realTokens: curve.realTokens,
      },
    ];
    if (curve.realTokens === 0n && !curve.complete) {
      curve.complete = true;
      events.push({ kind: "complete", mint });
    }
    const change = side === "buy" ? tokens : -tokens;
    const made = this.tx(events, [this.balance(mint, wallet, change), this.balance(mint, this.curveOwner(mint), -change)]);
    return { signature: made.signature, sol, tokens };
  }
  /** Moves coins between two wallets: no trade, only balances. */
  transfer(mint: string, from: string, to: string, tokens: bigint): string {
    return this.tx([], [this.balance(mint, from, -tokens), this.balance(mint, to, tokens)]).signature;
  }

  /** Makes a block out of everything done since the last one. `skip` leaves that many slots empty before it. */
  produce(skip = 0): ChainBlock {
    const parentSlot = this.slot;
    this.slot += 1 + skip;
    const hash = bs58.encode(createHash("sha256").update(`block:${this.branch}:${this.slot}:${this.tip}:${this.counter}`).digest());
    const block: ChainBlock = { slot: this.slot, hash, parentSlot, parentHash: this.tip, time: this.time, txs: this.pending };
    this.pending = [];
    this.tip = hash;
    this.blocks.set(this.slot, block);
    this.snapshots.set(this.slot, { curves: new Map([...this.curves].map(([mint, curve]) => [mint, { ...curve }])), held: new Map(this.held) });
    for (const listener of this.slotListeners) listener();
    return block;
  }
  /** Throws away every block above `slot`, as a reorganisation does. What is done next builds a different history from there. */
  forkAt(slot: number): void {
    const snapshot = this.snapshots.get(slot);
    if (!snapshot) throw new Error("the made-up chain has no block there to fork from");
    for (const known of [...this.blocks.keys()]) {
      if (known <= slot) continue;
      this.blocks.delete(known);
      this.snapshots.delete(known);
    }
    this.curves = new Map([...snapshot.curves].map(([mint, curve]) => [mint, { ...curve }]));
    this.held = new Map(snapshot.held);
    this.pending = [];
    this.slot = slot;
    this.tip = this.blocks.get(slot)?.hash ?? "genesis";
    this.branch += 1;
  }
  holding(mint: string, owner: string): bigint {
    return this.held.get(`${mint}|${owner}`) ?? 0n;
  }
  curve(mint: string): Curve {
    return this.curves.get(mint)!;
  }

  private check(): void {
    if (this.down) throw new Error("fetch failed");
  }
  head(): Promise<number> {
    this.check();
    return Promise.resolve(this.slot);
  }
  slots(from: number, to: number): Promise<number[]> {
    this.check();
    return Promise.resolve([...this.blocks.keys()].filter((slot) => slot >= from && slot <= to).sort((a, b) => a - b));
  }
  block(slot: number): Promise<ChainBlock | null> {
    this.check();
    return Promise.resolve(this.blocks.get(slot) ?? null);
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
