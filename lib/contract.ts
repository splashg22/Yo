/**
 * The contract between the browser and the server: every operation, what it takes and
 * what it returns. Amounts cross the wire as decimal strings of base units.
 */
import type { SealedNote } from "./notes";
import type { Offer, RingEvent } from "./server/store";

export type { Offer, RingEvent };
export type PublicRingEvent = Omit<RingEvent, "sealed" | "parties">;

export interface Config {
  network: "local" | "devnet";
  /** "mock": Ring balances are kept by the local stand-in, not by the Privacy Rings program. "unavailable": not connected on this network. */
  ring: "mock" | "unavailable";
  /** Parts of the product that are built but switched off unless the operator turns them on. */
  features: { sealedWindow: boolean };
  /**
   * This site's own fee. Rates are hundredths of a percent; all zero means no fee is charged anywhere.
   * A fee is paid in public, by its own instruction in the same transaction, to `wallet`.
   */
  fees: { wallet: string; tradeBps: number; launchLamports: string; otcBps: number };
}
export interface CoinView {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  createdAt: number;
  signature: string;
  /** Where the coin's picture can be fetched. Absent for a coin launched without one. */
  image?: string;
  /** False for a pump.fun coin that was made somewhere else and is only traded here. */
  launchedHere: boolean;
  marketCapLamports: string;
  /** The price of one whole coin, in millionths of a lamport. */
  microLamportsPerCoin: string;
  /** Price change in hundredths of a percent, since `changeSince`. */
  changeBasisPoints: number;
  changeSince: number;
  /** Price change over 5 minutes, 1 hour and 24 hours, in hundredths of a percent. Null: no trade to measure from. */
  change: { m5: number | null; h1: number | null; h24: number | null };
  volume24hLamports: string;
  /** The curve has sold out: the coin has graduated. */
  complete: boolean;
  /** A graduated coin whose pool exists, so it can be traded there. */
  hasPool: boolean;
  /** How far along the curve, in hundredths of a percent. */
  progressBps: number;
  holders: number;
  trades: number;
  lastTradeAt?: number;
  /** The privacy score: two public facts, each named for exactly what it measures. */
  privacy: { supply: string; inRing: string; shareInRingPartsPerMillion: number; walletsThatDeposited: number };
}
export interface Settlement {
  /** The public part of each deposit credited to the Ring ledger. */
  credited: Record<string, string>[];
  /** Coins newly listed. */
  listed: string[];
}
export interface Status {
  network: "local" | "devnet";
  ring: "mock" | "unavailable";
  checkedAt: number;
  chain: { reachable: boolean; slot?: number; version?: string; problem?: string };
  programs: { name: string; address: string; present: boolean }[];
  launchTable: boolean;
  coins: number;
  /** The wallet that holds deposited coins for the stand-in Ring, so anyone can check it on the chain. */
  escrowAddress: string;
  /** For each coin the Ring holds: what escrow has on-chain against what the ledger owes. */
  escrow: { mint: string; held: string; owed: string; covered: boolean }[];
  pendingPayouts: number;
}
export interface TransactionView {
  signature: string;
  status: "confirmed" | "failed" | "not-found";
  slot?: number;
  /** Seconds since 1970, as the chain recorded it. */
  blockTime?: number;
  feeLamports?: string;
  payer?: string;
  programs: string[];
  /** What the paying wallet gained (positive) or lost (negative) in this transaction, per coin, in base units. The SOL figure includes the network fee. */
  changes: { mint: string; amount: string }[];
  /** What this transaction paid into the Ring, if anything. Public. */
  deposits: Record<string, string>[];
}
/**
 * One trade as it travels to the page. Short keys, plain numbers: these are for showing, never for building a transaction.
 * s signature, i place in its transaction, t time (ms), w wallet, b 1 buy / 0 sell, sol lamports, tok coin base units,
 * p price after the trade (millionths of a lamport per coin), v venue (c curve, a pool).
 */
export interface TradeView {
  s: string;
  i: number;
  t: number;
  w: string;
  b: 0 | 1;
  /** Place of its transaction in the block. -1 while the trade is only heard of early. */
  x: number;
  sol: number;
  tok: number;
  p: number;
  v: "c" | "a";
  slot: number;
  /** Heard of before its block was read. The same trade follows without this mark once its block is applied. */
  early?: 1;
}
export interface HolderView {
  owner: string;
  amount: string;
  /** "curve", "creator", "ring": what the address is, where that is known. */
  tags: string[];
}
/** What a wallet has done in one coin, and what it is worth now. Amounts in lamports and coin base units, as strings. */
export interface PositionView {
  mint: string;
  symbol: string;
  name: string;
  image?: string;
  held: string;
  boughtLamports: string;
  boughtTokens: string;
  soldLamports: string;
  soldTokens: string;
  buys: number;
  sells: number;
  /** What the coins still held would fetch at the current price, before fees and slippage. */
  valueLamports: string;
  /** Sold, less the cost of what was sold at the average buy price. */
  realisedLamports: string;
  /** Value of what is held, less its cost at the average buy price. */
  unrealisedLamports: string;
  lastTradeAt: number;
}
/** Where a transaction handed to this server stands. */
export interface TxOutcomeView {
  signature: string;
  state: "sent" | "confirmed" | "failed" | "expired";
  slot?: number;
  problem?: string;
  settlement?: Settlement;
  landedInMs?: number;
}
export interface BuiltTradeView {
  transaction: string;
  /** Coins for a buy, lamports for a sell, at the price when it was built. */
  expected: string;
  /** This site's fee inside the transaction, in lamports. */
  feeLamports: string;
}
export interface TradeSettings {
  /** Hundredths of a percent. */
  slippageBps?: number;
  /** Lamports for the whole transaction. */
  priorityLamports?: string;
  tipLamports?: string;
}

/** One public transaction that touched an address. */
export interface Activity {
  signature: string;
  /** Seconds since 1970, as the chain recorded it. */
  blockTime?: number;
  failed: boolean;
}
export interface Stats {
  network: "local" | "devnet";
  available: boolean;
  reason?: string;
  launched?: number;
  registered?: number;
  depositors?: number;
}

/** What anyone may see of a sealed launch window. Who committed how much is not part of it. */
export interface WindowView {
  id: string;
  creator: string;
  name: string;
  symbol: string;
  description: string;
  openedAt: number;
  closesAt: number;
  status: "open" | "launching" | "launched" | "cancelled";
  committers: number;
  totalLamports: string;
  mint?: string;
  signature?: string;
}

/**
 * `signed`: true, the wallet signs each request; "read", the wallet's open session is enough (a signed request works too);
 * false, anyone may ask.
 */
type Op<Input, Output, IsSigned extends boolean | "read" = false> = { input: Input; output: Output; signed: IsSigned };
type Nothing = Record<string, never>;

export interface Api {
  config: Op<Nothing, Config>;
  status: Op<Nothing, Status>;
  stats: Op<Nothing, Stats>;
  faucet: Op<{ wallet: string }, { ok: true }>;
  /** The price of SOL in US dollars, with when it was published and where it came from. Null: there is none worth showing, and the site shows SOL alone. */
  "price/sol": Op<Nothing, { price: { usd: number; at: number; source: string } | null }>;
  /** One wallet signature opens a session for reading that wallet's own records and uploading a picture. It cannot move anything. */
  "session/open": Op<Nothing, { token: string; expiresAt: number }, true>;
  "session/close": Op<{ session: string }, { ok: true }>;
  /** Every coin the indexer follows. `seq` is the number of the live "board" channel as of this answer: subscribe from it and nothing is missed. */
  explore: Op<Nothing, { coins: CoinView[]; seq: number }>;
  coin: Op<{ mint: string }, CoinView & { seq: number }>;
  /** A coin's trades, newest first. `before` continues from the last trade of the previous page. `wallet` keeps only that wallet's. */
  "coin/trades": Op<{ mint: string; before?: { slot: number; x: number; i: number }; limit?: number; wallet?: string }, { trades: TradeView[]; seq: number }>;
  /** Candles, oldest first, each [time s, open, high, low, close, volume lamports, trades, buys]. `tf` is the bucket in seconds. */
  "coin/candles": Op<{ mint: string; tf: number; before?: number; limit?: number }, { candles: number[][]; seq: number }>;
  "coin/holders": Op<{ mint: string }, { holders: HolderView[]; supply: string; creator: string; seq: number }>;
  position: Op<{ wallet: string; mint: string }, { position: PositionView | null }>;
  portfolio: Op<{ wallet: string }, { positions: PositionView[] }>;
  /** The latest public transactions a wallet signed or received in, newest first. */
  "wallet/activity": Op<{ wallet: string }, { activity: Activity[] }>;
  "wallet/public": Op<{ wallet: string }, { balances: Record<string, string> }>;
  /** Whether the chain already has any transaction for an address. A destination that has never been seen gives away nothing but itself. */
  "address/seen": Op<{ address: string }, { seen: boolean }>;
  "launch/build": Op<
    {
      wallet: string;
      mint: string;
      name: string;
      symbol: string;
      firstBuyLamports?: string;
      toRing?: boolean;
      /** Up to 280 characters. */
      description?: string;
      /** A PNG, JPEG, WebP or GIF of at most 1.5 MB, in base64. It is redrawn as a 512px WebP before it is kept. */
      picture?: string;
      /** The launching wallet's session. Needed only with a picture. */
      session?: string;
    },
    { transaction: string; firstBuyTokens: string; feeLamports: string }
  >;
  "trade/build": Op<{ wallet: string; mint: string; side: "buy" | "sell"; amount: string } & TradeSettings, BuiltTradeView>;
  /** Several trades built ahead of the click. A trade that cannot be built (too small, or more than is held) comes back as null. */
  "trade/prepare": Op<
    { wallet: string; mint: string; buys?: string[]; sells?: string[] } & TradeSettings,
    { buys: (BuiltTradeView | null)[]; sells: (BuiltTradeView | null)[] }
  >;
  /** Makes the pool for a coin whose curve has sold out, so that it can be traded again. Anyone may; whoever signs pays for it. */
  "graduate/build": Op<{ wallet: string; mint: string }, { transaction: string }>;
  "fees/claimable": Op<{ wallet: string }, { lamports: string }>;
  "fees/build": Op<{ wallet: string; toRing?: boolean }, { transaction: string; claimable: string }>;
  /**
   * Hands a signed transaction to the network and answers at once with its signature. Only transactions this
   * server built are taken. The outcome arrives on the wallet's live channel, or from `tx/wait`.
   */
  "tx/send": Op<{ transaction: string; fast?: boolean }, TxOutcomeView>;
  /** Waits (up to `ms`, at most 25,000) for a transaction handed to `tx/send` to finish, and says where it stands. */
  "tx/wait": Op<{ signature: string; ms?: number }, TxOutcomeView>;
  "tx/status": Op<{ signature: string }, TransactionView>;
  "ring/deposit/build": Op<{ wallet: string; mint: string; amount: string }, { transaction: string }>;
  /** Looks again for the caller's deposits and payouts that this site has not recorded. Signed, and run at most once every few seconds. */
  "ring/recheck": Op<Nothing, { credited: number; payoutsResolved: number }, true>;
  "ring/public": Op<{ wallet?: string }, { events: PublicRingEvent[] }>;
  /** `noteKey` is the wallet's public note key, in base64, so that others can seal notes to it. */
  "ring/register": Op<{ noteKey?: string }, { newlyRegistered: boolean }, true>;
  /** A wallet's public note key, or null if it has not published one. */
  "ring/note-key": Op<{ wallet: string }, { key: string | null }>;
  /** `note` is already sealed in the sender's browser. The server cannot read it. */
  "ring/transfer": Op<{ to: string; mint: string; amount: string; note?: SealedNote }, { event: RingEvent }, true>;
  "ring/withdraw": Op<{ mint: string; amount: string; destination?: string }, { event: RingEvent; signature: string; pending: boolean }, true>;
  "ring/mine": Op<Nothing, { registered: boolean; balances: Record<string, string>; history: RingEvent[] }, "read">;
  "otc/offer": Op<{ buyer: string; mint: string; amount: string; priceLamports: string; hours?: number }, { offer: Offer }, true>;
  "otc/mine": Op<Nothing, { offers: Offer[] }, "read">;
  "otc/cancel": Op<{ id: string }, { offer: Offer }, true>;
  /** The sealed launch window. Every one of these refuses unless the feature is switched on. */
  "window/list": Op<Nothing, { windows: WindowView[]; limits: { capLamports: string; minimumLamports: string; longestHours: number } }>;
  "window/mine": Op<Nothing, { commitments: Record<string, string> }, "read">;
  "window/open": Op<{ name: string; symbol: string; description?: string; hours: number }, { window: WindowView }, true>;
  "window/commit": Op<{ id: string; lamports: string }, { window: WindowView }, true>;
  "window/uncommit": Op<{ id: string }, { window: WindowView }, true>;
  "window/cancel": Op<{ id: string }, { window: WindowView }, true>;
  /** The transaction comes back already signed by the stand-in's escrow, which makes the pooled buy. */
  "window/launch/build": Op<{ id: string; mint: string; picture?: string }, { transaction: string }, true>;
  "otc/accept": Op<{ id: string }, { offer: Offer; event: RingEvent }, true>;
}
export type OpName = keyof Api;
export type SessionOpName = { [K in OpName]: Api[K]["signed"] extends "read" ? K : never }[OpName];
export type SignedOpName = { [K in OpName]: Api[K]["signed"] extends true | "read" ? K : never }[OpName];
export type OpenOpName = Exclude<OpName, SignedOpName>;
