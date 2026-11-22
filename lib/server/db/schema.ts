/**
 * Every table, in one place. Run at each start: every statement is safe to repeat.
 * Amounts are `numeric` (exact, any size). Slots, times and counts are `bigint`.
 * Times are milliseconds since 1970 unless a column says seconds.
 */
export const SCHEMA = `
create table if not exists meta (key text primary key, value text not null);
insert into meta (key, value) values ('version', '0') on conflict do nothing;

-- ---- the stand-in Ring ledger and the site's own records -------------------------------
-- One row per balance. The database itself refuses a balance below zero.
create table if not exists ring_balances (
  wallet text not null, mint text not null, amount numeric not null check (amount >= 0),
  primary key (wallet, mint)
);
-- One row per transaction already credited. A second credit of the same signature is refused by the primary key.
create table if not exists credited (signature text primary key, seq bigint generated always as identity);
create table if not exists nonces (entry text primary key);
-- Everything else the site records: events, coins, offers, windows, pending payouts, note keys. One row each.
create table if not exists records (
  collection text not null, key text not null, ord bigint not null, body json not null,
  primary key (collection, key)
);
create index if not exists records_order on records (collection, ord);

-- ---- what the indexer reads from the chain -----------------------------------------------
-- The blocks applied so far that could still be reorganised away. The highest slot here is the cursor.
create table if not exists blocks (
  slot bigint primary key, hash text not null, parent_slot bigint not null, parent_hash text not null, at bigint not null
);
-- One row per coin the indexer follows: the curve as of the last applied trade.
create table if not exists markets (
  mint text primary key,
  creator text not null,
  created_at bigint not null,
  created_slot bigint not null,
  supply numeric not null,
  initial_real_tokens numeric not null,
  virtual_sol numeric not null,
  virtual_tokens numeric not null,
  real_sol numeric not null,
  real_tokens numeric not null,
  complete boolean not null default false,
  completed_at bigint,
  last_trade_at bigint,
  -- The pool the coin trades in after it graduated, once one exists.
  pool text,
  -- As the coin's own creation event gave them. Shown for a coin that was not launched on this site.
  name text not null default '',
  symbol text not null default '',
  uri text not null default '',
  holders int not null default 0,
  trades int not null default 0
);
create index if not exists markets_by_pool on markets (pool);
-- Added on 22 November 2026. seen_from: the slot a coin already trading was first seen at (null: followed from its creation).
-- quote: what a coin is priced in when that is not SOL (null: SOL).
alter table markets add column if not exists seen_from bigint;
alter table markets add column if not exists quote text;
-- Added on 22 November 2026. venue: where a coin that is not pump.fun's takes its price from (null: pump.fun). decimals: the coin's own, when not six.
alter table markets add column if not exists venue text;
-- priced_in: the coin a coin is priced in, when its amounts were turned into lamports at that coin's price (null: priced in SOL, or see quote).
alter table markets add column if not exists priced_in text;
alter table markets add column if not exists decimals int;
-- Pools of other programs, read from the chain once each: which coin a pool trades and against what.
create table if not exists venue_pools (
  pool text primary key,
  venue text not null,
  mint text not null,
  coin_is_a boolean not null,
  decimals int not null,
  supply numeric not null,
  quote text not null
);
-- Added on 22 November 2026. What a coin's own accounts on the chain say of it (lib/server/describe.ts): the facts the safety checks rest on.
create table if not exists coin_facts (
  mint text primary key,
  facts jsonb not null
);
-- One row per trade. The key is the transaction and the trade's place inside it, so a trade can never be counted twice.
create table if not exists trades (
  signature text not null, idx int not null,
  mint text not null, slot bigint not null, tx_index int not null, at bigint not null,
  wallet text not null, is_buy boolean not null, venue text not null default 'curve',
  sol numeric not null, tokens numeric not null,
  price numeric not null,
  -- The price just before this trade. A candle rebuilt from trades opens here, exactly as it did when first built.
  price_before numeric not null default 0,
  virtual_sol numeric not null, virtual_tokens numeric not null, real_sol numeric not null, real_tokens numeric not null,
  primary key (signature, idx)
);
create index if not exists trades_by_coin on trades (mint, slot desc, tx_index desc, idx desc);
create index if not exists trades_by_wallet on trades (wallet, mint, slot);
create index if not exists trades_by_slot on trades (slot);
-- Candles. tf is the bucket length in seconds; t is the bucket's start in seconds.
create table if not exists candles (
  mint text not null, tf int not null, t bigint not null,
  o numeric not null, h numeric not null, l numeric not null, c numeric not null,
  vol_sol numeric not null, vol_tokens numeric not null, n int not null, buys int not null,
  primary key (mint, tf, t)
);
-- Who holds each coin now, from the balances the chain records after every transaction.
create table if not exists holders (
  mint text not null, owner text not null, amount numeric not null, slot bigint not null,
  primary key (mint, owner)
);
create index if not exists holders_top on holders (mint, amount desc);
-- What a holder's balance was before a block changed it, kept while that block could still be reorganised away.
create table if not exists holder_undo (
  slot bigint not null, mint text not null, owner text not null, amount numeric, prev_slot bigint,
  primary key (slot, mint, owner)
);
-- What a market's row was before a block changed it, for the same reason. Null body: the market did not exist.
create table if not exists market_undo (slot bigint not null, mint text not null, body jsonb, primary key (slot, mint));
`;
