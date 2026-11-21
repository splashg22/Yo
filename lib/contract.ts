/**
 * The contract between the browser and the server: every operation, what it takes and
 * what it returns. Amounts cross the wire as decimal strings of base units.
 */
import type { Offer, RingEvent } from "./server/store";

export type { Offer, RingEvent };
export type PublicRingEvent = Omit<RingEvent, "sealed" | "parties">;

export interface Config {
  network: "local" | "devnet";
  /** "mock": Ring balances are kept by the local stand-in, not by the Privacy Rings program. */
  ring: "mock";
}
export interface CoinView {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  createdAt: number;
  signature: string;
  marketCapLamports: string;
  /** The price of one whole coin, in millionths of a lamport. */
  microLamportsPerCoin: string;
  /** Price change in hundredths of a percent, since `changeSince`. */
  changeBasisPoints: number;
  changeSince: number;
  complete: boolean;
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
  ring: "mock";
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
  /** What this transaction paid into the Ring, if anything. Public. */
  deposits: Record<string, string>[];
}
export interface Stats {
  network: "local" | "devnet";
  available: boolean;
  reason?: string;
  launched?: number;
  registered?: number;
  depositors?: number;
}

type Op<Input, Output, IsSigned extends boolean = false> = { input: Input; output: Output; signed: IsSigned };
type Nothing = Record<string, never>;

export interface Api {
  config: Op<Nothing, Config>;
  status: Op<Nothing, Status>;
  stats: Op<Nothing, Stats>;
  faucet: Op<{ wallet: string }, { ok: true }>;
  explore: Op<Nothing, { coins: CoinView[] }>;
  coin: Op<{ mint: string }, CoinView>;
  "wallet/public": Op<{ wallet: string }, { balances: Record<string, string> }>;
  "launch/build": Op<
    { wallet: string; mint: string; name: string; symbol: string; firstBuyLamports?: string; toRing?: boolean },
    { transaction: string; firstBuyTokens: string }
  >;
  "trade/build": Op<{ wallet: string; mint: string; side: "buy" | "sell"; amount: string }, { transaction: string; expected: string }>;
  "fees/claimable": Op<{ wallet: string }, { lamports: string }>;
  "fees/build": Op<{ wallet: string; toRing?: boolean }, { transaction: string; claimable: string }>;
  "tx/send": Op<{ transaction: string }, { signature: string } & Settlement>;
  "tx/status": Op<{ signature: string }, TransactionView>;
  "ring/deposit/build": Op<{ wallet: string; mint: string; amount: string }, { transaction: string }>;
  "ring/credit": Op<{ signature: string }, Settlement>;
  "ring/reconcile": Op<Nothing, { credited: number; payoutsResolved: number }>;
  "ring/public": Op<{ wallet?: string }, { events: PublicRingEvent[] }>;
  "ring/register": Op<Nothing, { newlyRegistered: boolean }, true>;
  "ring/transfer": Op<{ to: string; mint: string; amount: string; memo?: string }, { event: RingEvent }, true>;
  "ring/withdraw": Op<{ mint: string; amount: string; destination?: string }, { event: RingEvent; signature: string; pending: boolean }, true>;
  "ring/mine": Op<Nothing, { registered: boolean; balances: Record<string, string>; history: RingEvent[] }, true>;
  "otc/offer": Op<{ buyer: string; mint: string; amount: string; priceLamports: string; hours?: number }, { offer: Offer }, true>;
  "otc/mine": Op<Nothing, { offers: Offer[] }, true>;
  "otc/cancel": Op<{ id: string }, { offer: Offer }, true>;
  "otc/accept": Op<{ id: string }, { offer: Offer; event: RingEvent }, true>;
}
export type OpName = keyof Api;
export type SignedOpName = { [K in OpName]: Api[K]["signed"] extends true ? K : never }[OpName];
export type OpenOpName = Exclude<OpName, SignedOpName>;
