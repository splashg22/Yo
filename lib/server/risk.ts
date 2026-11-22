/**
 * The risk figures of a coin, each worked out from this server's own record of the chain by a rule stated here.
 * Other terminals show such figures without saying how they are reached. These are the rules, in full.
 *
 * All shares are of the coin's whole supply, in hundredths of a percent, counting what a wallet holds NOW.
 * The bonding curve and the pool hold coins but are not holders: they are left out of every figure.
 *
 *   top ten      the ten largest holders, together.
 *   dev          the wallet that created the coin: what it holds, and how many times it has sold.
 *   snipers      wallets other than the creator that bought within SNIPE_SLOTS slots of the coin's creation
 *                (the creation slot counts as the first). How many there were, and what they still hold.
 *   bundles      among those early buyers: the ones who bought in a slot in which BUNDLE_WALLETS or more
 *                different wallets bought. Several wallets buying in one slot at a launch are usually one
 *                person's wallets sent together. How many, and what they still hold.
 *   insiders     wallets, other than the creator, that hold the coin and have never bought it on the curve or
 *                in its pool: they were sent it. How many, and what they hold.
 *
 * What the rules cannot see, said plainly:
 * - They need the coin's record from its first block. For a coin that was already trading when this server first
 *   saw it, the three launch figures are not known, and that is what is shown: not zero.
 * - "Never bought" means no buy recorded here in that wallet's name. Coins bought through another program that
 *   trades for the wallet, or moved between one person's own wallets, look the same as coins handed to an insider.
 * - Two wallets are not known to be one person. A bundle is an inference from timing, and a careful launcher who
 *   spreads buys over several slots is not caught by it.
 */
import type { Db } from "./db";
import { BUNDLE_WALLETS, SNIPE_SLOTS } from "../risk-rules";
import type { Market } from "./indexer/model";

export { BUNDLE_WALLETS, SNIPE_SLOTS };

export interface Risk {
  /** Hundredths of a percent of supply. */
  top10Bps: number;
  devBps: number;
  devSells: number;
  /** Null when the coin was not followed from its creation: not known, which is not the same as none. */
  snipers: { wallets: number; heldBps: number } | null;
  bundles: { wallets: number; heldBps: number } | null;
  insiders: { wallets: number; heldBps: number } | null;
}

interface Row {
  top10: string;
  dev: string;
  dev_sells: number;
  sniper_count: number;
  sniper_held: string;
  bundler_count: number;
  bundle_held: string;
  insider_count: number;
  insider_held: string;
}

/** `venues` are the addresses that hold the coin without being holders: its bonding curve, and its pool if it has one. */
export async function riskOf(db: Db, market: Market, venues: string[]): Promise<Risk> {
  const [row] = await db.query<Row>(
    `with h as (select owner, amount from holders where mint = $1 and amount > 0 and owner <> all($2::text[])),
          early as (select wallet, slot from trades where mint = $1 and is_buy and slot <= $3 and wallet <> $4),
          snipers as (select distinct wallet from early),
          crowded as (select slot from early group by slot having count(distinct wallet) >= $5),
          bundlers as (select distinct wallet from early where slot in (select slot from crowded)),
          buyers as (select distinct wallet from trades where mint = $1 and is_buy),
          given as (select owner, amount from h where owner <> $4 and owner not in (select wallet from buyers))
     select
       (select coalesce(sum(amount), 0) from (select amount from h order by amount desc limit 10) top)::text as top10,
       (select coalesce(sum(amount), 0) from h where owner = $4)::text as dev,
       (select count(*) from trades where mint = $1 and wallet = $4 and not is_buy)::int as dev_sells,
       (select count(*) from snipers)::int as sniper_count,
       (select coalesce(sum(h.amount), 0) from h join snipers s on s.wallet = h.owner)::text as sniper_held,
       (select count(*) from bundlers)::int as bundler_count,
       (select coalesce(sum(h.amount), 0) from h join bundlers b on b.wallet = h.owner)::text as bundle_held,
       (select count(*) from given)::int as insider_count,
       (select coalesce(sum(amount), 0) from given)::text as insider_held`,
    [market.mint, venues, market.createdSlot + SNIPE_SLOTS - 1, market.creator, BUNDLE_WALLETS],
  );
  const bps = (amount: string): number => (market.supply > 0n ? Number((BigInt(amount) * 10_000n) / market.supply) : 0);
  // A coin first seen through a trade: its creator is not known and its launch was not watched.
  const fromBirth = market.seenFromSlot === undefined;
  return {
    top10Bps: bps(row!.top10),
    devBps: fromBirth ? bps(row!.dev) : 0,
    devSells: fromBirth ? row!.dev_sells : 0,
    snipers: fromBirth ? { wallets: row!.sniper_count, heldBps: bps(row!.sniper_held) } : null,
    bundles: fromBirth ? { wallets: row!.bundler_count, heldBps: bps(row!.bundle_held) } : null,
    insiders: fromBirth ? { wallets: row!.insider_count, heldBps: bps(row!.insider_held) } : null,
  };
}
