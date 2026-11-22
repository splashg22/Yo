/** What the indexer takes from the chain, already decoded. A source of these can be the RPC or, in tests, a made-up chain. */

/** Where a trade happened: on a coin's bonding curve, or in its pool after it graduated. */
export type Venue = "curve" | "amm";

export interface CreateEvent {
  kind: "create";
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  uri: string;
  supply: bigint;
  virtualSol: bigint;
  virtualTokens: bigint;
  realTokens: bigint;
  /** Present when the coin is priced in something other than SOL: what it is priced in. Such a coin is listed and not traded here. */
  quoteMint?: string;
}
export interface TradeEvent {
  kind: "trade";
  venue: Venue;
  mint: string;
  wallet: string;
  isBuy: boolean;
  /** Lamports paid (buy) or received (sell), before fees. */
  sol: bigint;
  /** Coin base units received (buy) or sold (sell). */
  tokens: bigint;
  /** The reserves after this trade. The price is their ratio. For a pool, the virtual and real reserves are the same. */
  virtualSol: bigint;
  virtualTokens: bigint;
  realSol: bigint;
  realTokens: bigint;
}
export interface CompleteEvent {
  kind: "complete";
  mint: string;
}
/** A graduated coin's pool was made. From here the coin trades in the pool. */
export interface PoolEvent {
  kind: "pool";
  mint: string;
  pool: string;
}
export type ChainEvent = CreateEvent | TradeEvent | CompleteEvent | PoolEvent;

export interface ChainTx {
  signature: string;
  /** Position in its block. */
  index: number;
  events: ChainEvent[];
  /** Coin balances the chain recorded after this transaction, for every coin account it touched. A closed account is zero. */
  balances: { mint: string; owner: string; amount: bigint }[];
}
export interface ChainBlock {
  slot: number;
  hash: string;
  parentSlot: number;
  parentHash: string;
  /** Seconds since 1970, as the chain recorded it. */
  time: number;
  txs: ChainTx[];
}
/** A transaction seen through the log subscription, before its block has been read. */
export interface EarlyTx {
  slot: number;
  signature: string;
  events: ChainEvent[];
}
export interface ChainSource {
  /**
   * "stream": the blocks are gathered from a stream of transactions. They carry no real hashes, so a block is not
   * tested against the one before it, and a range of slots costs nothing to ask for. Absent: blocks read from a chain.
   */
  readonly kind?: "stream";
  /** The newest confirmed slot. */
  head(): Promise<number>;
  /** The confirmed slots in a range, both ends included, in order. Skipped slots are left out. */
  slots(from: number, to: number): Promise<number[]>;
  /** One confirmed block, or null if the slot was skipped. */
  block(slot: number): Promise<ChainBlock | null>;
  /** Calls `onSlot` when the chain moves and `onEarly` when a transaction with events is seen. Returns how to stop. */
  watch(onSlot: () => void, onEarly: (tx: EarlyTx) => void): () => void;
}
