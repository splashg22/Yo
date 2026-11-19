import type { Built, Chain, HolderSnapshot, SimResult, TxStatus } from "../src/cycle.js";
import type { Ledger, LedgerEntry } from "../src/ledger.js";
import { emptyState, type Mints, type QueueItem, type State, type StateStore, type Target } from "../src/state.js";

export const MINTS: Mints = { strategyMint: "STRAT", burnMint: "DCTY", holderMint: "STRAT", quoteMint: "TTWO" };

export class MemoryStore implements StateStore {
  saved: State | null = null;
  saves = 0;
  load(mints: Mints): State {
    return this.saved ? (JSON.parse(JSON.stringify(this.saved)) as State) : emptyState(mints);
  }
  save(state: State): void {
    this.saved = JSON.parse(JSON.stringify(state)) as State;
    this.saves += 1;
  }
}

export class MemoryLedger implements Ledger {
  entries: LedgerEntry[] = [];
  append(entry: LedgerEntry): void {
    this.entries.push(entry);
  }
  has(type: LedgerEntry["type"], signature: string): boolean {
    return this.entries.some((e) => e.type === type && e.signature === signature);
  }
  of(type: LedgerEntry["type"]) {
    return this.entries.filter((e) => e.type === type);
  }
}

type Effect = { quote: bigint; coin: bigint; self: bigint; apply: () => void };

/** A pretend chain: a treasury, a fee vault, fixed swap prices and holders. */
export class FakeChain implements Chain {
  sol = 1_000_000_000n;
  quote = 0n;
  /** burn coin (DCTY) held by the treasury */
  coin = 0n;
  /** strategy coin held by the treasury */
  self = 0n;
  vault = 0n;
  /** burn coin received per TTWO base unit */
  price = 10n;
  /** strategy coin received per TTWO base unit */
  selfPrice = 100n;
  holders = new Map<string, bigint>();
  excluded = new Set<string>();
  received = new Map<string, bigint>();
  burned = 0n;
  selfBurned = 0n;
  hasRoute = true;
  hasSelfRoute = true;
  snapshotWorks = true;
  /** wallets whose transfer fails in simulation */
  rejects = new Set<string>();
  /** called when a transaction is sent; return what the network does with it */
  onSend: (kind: string) => "land" | "drop" | "crash" = () => "land";
  sent: string[] = [];
  private crashNext = false;
  private counter = 0;
  private effects = new Map<string, Effect>();
  private kinds = new Map<string, string>();
  private fails = new Map<string, string>();
  private landed = new Map<string, Effect>();
  private dropped = new Set<string>();

  mints() {
    return MINTS;
  }
  async balances() {
    return { sol: this.sol, quote: this.quote, coin: this.coin, self: this.self };
  }
  async pendingFees() {
    return this.vault;
  }
  private make(kind: string, effect: Omit<Effect, "self"> & { self?: bigint }, failure?: string): Built {
    const signature = `sig${++this.counter}-${kind}`;
    this.effects.set(signature, { self: 0n, ...effect });
    this.kinds.set(signature, kind);
    if (failure) this.fails.set(signature, failure);
    return { signature, lastValidBlockHeight: 100, raw: new Uint8Array() };
  }
  async buildClaim() {
    const amount = this.vault;
    return this.make("claim", { quote: amount, coin: 0n, apply: () => { this.vault -= amount; this.quote += amount; } });
  }
  private routeOk(target: Target) {
    return target === "self" ? this.hasSelfRoute : this.hasRoute;
  }
  async describeRoute(target: Target) {
    if (!this.routeOk(target)) throw new Error(`no curve or pool for TTWO -> ${target === "self" ? "STRAT" : "DCTY"}`);
    return `TTWO -> ${target === "self" ? "STRAT" : "DCTY"} on the bonding curve`;
  }
  async buildSwap(amountIn: bigint, target: Target) {
    if (!this.routeOk(target)) throw new Error(`no curve or pool for TTWO -> ${target === "self" ? "STRAT" : "DCTY"}`);
    if (amountIn > this.quote) throw new Error("simulation failed: insufficient funds");
    const out = amountIn * (target === "self" ? this.selfPrice : this.price);
    const built = target === "self"
      ? this.make("buyback", { quote: -amountIn, coin: 0n, self: out, apply: () => { this.quote -= amountIn; this.self += out; } })
      : this.make("swap", { quote: -amountIn, coin: out, apply: () => { this.quote -= amountIn; this.coin += out; } });
    return { ...built, expectedOut: out, minOut: (out * 97n) / 100n };
  }
  async buildBurn(amount: bigint, target: Target) {
    return target === "self"
      ? this.make("buyback_burn", { quote: 0n, coin: 0n, self: -amount, apply: () => { this.self -= amount; this.selfBurned += amount; } })
      : this.make("burn", { quote: 0n, coin: -amount, apply: () => { this.coin -= amount; this.burned += amount; } });
  }
  async buildPayout(items: readonly QueueItem[], options: { withClaim?: boolean } = {}) {
    const total = items.reduce((a, i) => a + BigInt(i.amount), 0n);
    const claim = options.withClaim ? this.vault : 0n;
    const bad = items.find((i) => this.rejects.has(i.owner));
    const failure = bad ? `account of ${bad.owner} is frozen` : total > this.quote + claim ? "insufficient funds" : undefined;
    return this.make("payout", {
      quote: claim - total, coin: 0n,
      apply: () => {
        this.vault -= claim;
        this.quote += claim - total;
        for (const i of items) this.received.set(i.owner, (this.received.get(i.owner) ?? 0n) + BigInt(i.amount));
      },
    }, failure);
  }
  async simulate(built: Built): Promise<SimResult> {
    const failure = this.fails.get(built.signature);
    return failure ? { ok: false, error: failure } : { ok: true };
  }
  async send(built: Built) {
    this.sent.push(built.signature);
    const fate = this.onSend(this.kinds.get(built.signature)!);
    const effect = this.effects.get(built.signature)!;
    if (fate === "drop") {
      this.dropped.add(built.signature);
      return;
    }
    effect.apply();
    this.landed.set(built.signature, effect);
    if (fate === "crash") this.crashNext = true;
  }
  async status(signature: string): Promise<TxStatus> {
    if (this.crashNext) {
      this.crashNext = false;
      throw new CrashError();
    }
    if (this.landed.has(signature)) return "confirmed";
    if (this.dropped.has(signature)) return "expired";
    return "unknown";
  }
  async deltas(signature: string) {
    const effect = this.landed.get(signature)!;
    return { quote: effect.quote, coin: effect.coin, self: effect.self };
  }
  async snapshotHolders(): Promise<HolderSnapshot> {
    if (!this.snapshotWorks) throw new Error("getProgramAccounts is disabled on this RPC");
    return { balances: new Map(this.holders), excluded: new Set(this.excluded), source: "fake" };
  }
}

/** Simulates the process dying right after a transaction was broadcast. */
export class CrashError extends Error {}
