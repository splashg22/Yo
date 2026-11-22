/**
 * Reads, from the chain, which coin a Meteora pool trades: the one thing a swap event does not say. A pool seen
 * trading waits here until it has been read; then its swaps are read as trades from the next block on.
 * Paced like the reading of coins (lib/server/describe.ts): at most one pass a second, fifty pools a pass, two calls
 * a pass (the pools, then their coins). A pool is read once and kept.
 */
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { DAMM2_PROGRAM, poolAccount, type PoolFacts } from "./indexer/meteora";

export const POOLS_A_PASS = 50;
const PACE_MS = 1_000;
const RETRY_AFTER_MS = 300_000;
const WSOL = "So11111111111111111111111111111111111111112";
type Info = AccountInfo<Buffer> | null;

/** What a pool trades, from its own account and its coin's. Undefined if either is not what it should be. */
export function poolFactsFrom(pool: string, poolInfo: Info, coinOf: (mint: string) => Info): PoolFacts | undefined {
  if (!poolInfo || poolInfo.owner.toBase58() !== DAMM2_PROGRAM) return undefined;
  const read = poolAccount(poolInfo.data);
  if (!read) return undefined;
  // The coin is the side that is not SOL. A pool with SOL on neither side is kept as such, and not read as trades.
  const coinIsA = read.mintA !== WSOL;
  const mint = coinIsA ? read.mintA : read.mintB;
  const quote = coinIsA ? read.mintB : read.mintA;
  const info = coinOf(mint);
  if (!info || !(info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(TOKEN_2022_PROGRAM_ID))) return undefined;
  try {
    const coin = unpackMint(new PublicKey(mint), info, info.owner);
    return { pool, mint, coinIsA, decimals: coin.decimals, supply: coin.supply, quote };
  } catch {
    return undefined;
  }
}

export interface PoolHost {
  waiting(most: number, skip: (pool: string) => boolean): string[];
  accounts(keys: PublicKey[]): Promise<Info[]>;
  learned(facts: PoolFacts): Promise<void>;
  /** A pool that could not be read as one. */
  unreadable(pool: string): void;
  problem(error: unknown): void;
}

export class PoolReader {
  private readonly tried = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  /** Calls made to the chain, for /health and for tests that hold it to a budget. */
  calls = 0;
  constructor(private readonly host: PoolHost) {}

  start(): void {
    this.timer = setInterval(() => void this.step(), PACE_MS);
  }
  stop(): void {
    clearInterval(this.timer);
  }
  /** One paced pass. Returns how many pools were learned. */
  async step(): Promise<number> {
    if (this.running) return 0;
    const now = Date.now();
    const pools = this.host.waiting(POOLS_A_PASS, (pool) => now - (this.tried.get(pool) ?? 0) < RETRY_AFTER_MS);
    if (pools.length === 0) return 0;
    this.running = true;
    try {
      for (const pool of pools) this.tried.set(pool, now);
      this.calls += 1;
      const poolInfos = await this.host.accounts(pools.map((pool) => new PublicKey(pool)));
      const coins = new Set<string>();
      poolInfos.forEach((info) => {
        const read = info ? poolAccount(info.data) : undefined;
        if (read) for (const mint of [read.mintA, read.mintB]) if (mint !== WSOL) coins.add(mint);
      });
      const coinList = [...coins];
      const coinInfos = new Map<string, Info>();
      if (coinList.length > 0) {
        this.calls += 1;
        (await this.host.accounts(coinList.map((mint) => new PublicKey(mint)))).forEach((info, index) => coinInfos.set(coinList[index]!, info));
      }
      let learned = 0;
      for (const [index, pool] of pools.entries()) {
        const facts = poolFactsFrom(pool, poolInfos[index] ?? null, (mint) => coinInfos.get(mint) ?? null);
        if (!facts) {
          // The chain answered and this is not a pool that can be read: it is not asked about again.
          if (poolInfos[index] !== undefined) this.host.unreadable(pool);
          continue;
        }
        await this.host.learned(facts);
        learned += 1;
      }
      if (this.tried.size > 50_000) this.tried.clear();
      return learned;
    } catch (error) {
      this.host.problem(error);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
