"use client";

/** The tables under the chart: the live trades feed and the holders, each drawn only as far as it is in view. */
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { CoinStore } from "@/lib/client/coin-store";
import { COIN_DECIMALS } from "@/lib/constants";
import type { CoinView, HolderView, TradeView } from "@/lib/contract";
import { formatAmount, formatCompact, formatShare, formatSol, shortAddress } from "@/lib/format";
import { Segments } from "../ui/controls";
import { CoinPrice, Time, UsdOfSol } from "../ui/Money";
import { useVirtual } from "../ui/useVirtual";

const TRADE_COLUMNS = "56px 48px minmax(84px, 1fr) minmax(84px, 1fr) minmax(110px, 1.2fr) minmax(120px, 1.2fr)";
const HOLDER_COLUMNS = "40px minmax(160px, 2fr) minmax(110px, 1fr) 84px minmax(80px, 1fr)";
const ROW = 30;
const TAG_TEXT: Record<string, string> = { curve: "Bonding curve", creator: "Creator", ring: "Ring stand-in", pool: "Pool" };

export function Feed({ store, coin, me }: { store: CoinStore; coin: CoinView; me: string | null }) {
  const [tab, setTab] = useState<"trades" | "holders">("trades");
  const [who, setWho] = useState<"all" | "mine" | "creator">("all");
  const all = useSyncExternalStore(
    store.listen,
    () => store.trades,
    () => store.trades,
  );
  const holders = useSyncExternalStore(store.listen, store.holderList, store.holderList);
  const trades = useMemo(() => (who === "all" ? all : all.filter((trade) => trade.w === (who === "mine" ? me : coin.creator))), [all, who, me, coin.creator]);

  return (
    <section className="feed" aria-label="Trades and holders">
      <div className="feed-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "trades"} onClick={() => setTab("trades")}>
          Trades <span className="quiet mono">{formatCompact(coin.trades)}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "holders"} onClick={() => setTab("holders")}>
          Holders <span className="quiet mono">{formatCompact(coin.holders)}</span>
        </button>
        {tab === "trades" && (
          <div className="tools">
            <Segments
              label="Whose trades"
              value={who}
              onChange={setWho}
              options={[{ value: "all", label: "All" }, ...(me ? [{ value: "mine" as const, label: "Mine" }] : []), { value: "creator", label: "Creator" }]}
            />
          </div>
        )}
      </div>
      {tab === "trades" ? <Trades trades={trades} coin={coin} me={me} /> : <Holders holders={holders} supply={BigInt(coin.privacy.supply)} me={me} />}
    </section>
  );
}

function Trades({ trades, coin, me }: { trades: TradeView[]; coin: CoinView; me: string | null }) {
  const list = useVirtual(trades.length, ROW);
  if (trades.length === 0) {
    return (
      <div className="feed-body">
        <p className="body" style={{ padding: "16px 0" }}>
          No trades to show yet.
        </p>
      </div>
    );
  }
  const rows = [];
  for (let index = list.first; index <= list.last; index++) {
    const trade = trades[index]!;
    rows.push(
      <div
        key={`${trade.s}:${trade.i}`}
        role="row"
        className={`vrow${trade.w === me ? " mine" : ""}`}
        style={{ ...list.place(index), top: list.place(index).top + ROW, gridTemplateColumns: TRADE_COLUMNS }}
        data-trade={trade.s}
        data-early={trade.early ? "1" : undefined}
      >
        <span role="cell">{trade.early ? <span className="quiet">now</span> : <Time at={trade.t} />}</span>
        <span role="cell" className={`px ${trade.b ? "up" : "down"}`} style={{ fontSize: 11, letterSpacing: "0.14em" }}>
          {trade.b ? "Buy" : "Sell"}
        </span>
        <span role="cell" className="r num" title={formatSol(BigInt(trade.sol), 9)}>
          {formatSol(BigInt(trade.sol)).replace(" SOL", "")}
        </span>
        <span role="cell" className="r">
          <UsdOfSol lamports={trade.sol} compact={false} />
        </span>
        <span role="cell" className="r num" title={formatAmount(BigInt(trade.tok), COIN_DECIMALS)}>
          {formatCompact(trade.tok / 10 ** COIN_DECIMALS)}
        </span>
        <span role="cell" className="r">
          <Link className="address" href={`/tx/${trade.s}`} title={trade.w}>
            {shortAddress(trade.w)}
          </Link>
          {trade.w === coin.creator && <span className="tag hot">Creator</span>}
          {trade.w === me && <span className="tag">You</span>}
          {trade.early && <span className="tag">Pending</span>}
        </span>
      </div>,
    );
  }
  return (
    <div className="feed-body" ref={list.scroller} role="table" aria-label="Trades, newest first" aria-rowcount={trades.length}>
      <div style={{ height: list.total + ROW, position: "relative" }}>
        <div className="vhead" role="row" style={{ gridTemplateColumns: TRADE_COLUMNS }}>
          <span role="columnheader">Age</span>
          <span role="columnheader">Side</span>
          <span role="columnheader" className="r">
            SOL
          </span>
          <span role="columnheader" className="r">
            USD
          </span>
          <span role="columnheader" className="r">
            {coin.symbol}
          </span>
          <span role="columnheader" className="r">
            Wallet
          </span>
        </div>
        {rows}
      </div>
    </div>
  );
}

function Holders({ holders, supply, me }: { holders: HolderView[]; supply: bigint; me: string | null }) {
  const list = useVirtual(holders.length, ROW);
  // Share of supply held by the ten largest wallets that are people, not the curve or a pool.
  const people = holders.filter((holder) => !holder.tags.includes("curve") && !holder.tags.includes("pool"));
  const topTen = people.slice(0, 10).reduce((sum, holder) => sum + BigInt(holder.amount), 0n);
  const creator = holders.find((holder) => holder.tags.includes("creator"));
  const share = (amount: bigint): string => (supply > 0n ? formatShare(Number((amount * 1_000_000n) / supply)) : "");
  if (holders.length === 0) {
    return (
      <div className="feed-body">
        <p className="body" style={{ padding: "16px 0" }}>
          No holders to show yet.
        </p>
      </div>
    );
  }
  const rows = [];
  for (let index = list.first; index <= list.last; index++) {
    const holder = holders[index]!;
    const amount = BigInt(holder.amount);
    const parts = supply > 0n ? Number((amount * 1_000_000n) / supply) : 0;
    rows.push(
      <div
        key={holder.owner}
        role="row"
        className={`vrow${holder.owner === me ? " mine" : ""}`}
        style={{ ...list.place(index), top: list.place(index).top + ROW + 34, gridTemplateColumns: HOLDER_COLUMNS }}
      >
        <span role="cell" className="quiet num">
          {index + 1}
        </span>
        <span role="cell">
          <span className="address" title={holder.owner}>
            {shortAddress(holder.owner)}
          </span>
          {holder.tags.map((tag) => (
            <span key={tag} className={`tag${tag === "creator" ? " hot" : ""}`}>
              {TAG_TEXT[tag] ?? tag}
            </span>
          ))}
          {holder.owner === me && <span className="tag">You</span>}
        </span>
        <span role="cell" className="r num" title={formatAmount(amount, COIN_DECIMALS)}>
          {formatCompact(Number(amount) / 10 ** COIN_DECIMALS)}
        </span>
        <span role="cell" className="r num">
          {formatShare(parts)}
        </span>
        <span role="cell">
          <span className="meter" style={{ display: "block" }}>
            <i style={{ width: `${Math.min(100, parts / 10_000)}%` }} />
          </span>
        </span>
      </div>,
    );
  }
  return (
    <div className="feed-body" ref={list.scroller} role="table" aria-label="Holders, largest first" aria-rowcount={holders.length}>
      <div style={{ height: list.total + ROW + 34, position: "relative" }}>
        <p className="note-line" style={{ height: 34, display: "flex", alignItems: "center", gap: 18 }} data-holder-summary>
          <span>
            Ten largest wallets hold <b className="num">{share(topTen)}</b>
          </span>
          <span>
            Creator holds <b className="num">{creator ? share(BigInt(creator.amount)) : "0.00%"}</b>
          </span>
          <span className="quiet">The largest hundred are listed.</span>
        </p>
        <div className="vhead" role="row" style={{ gridTemplateColumns: HOLDER_COLUMNS, top: 0 }}>
          <span role="columnheader">#</span>
          <span role="columnheader">Wallet</span>
          <span role="columnheader" className="r">
            Coins
          </span>
          <span role="columnheader" className="r">
            Of supply
          </span>
          <span role="columnheader" />
        </div>
        {rows}
      </div>
    </div>
  );
}

/** The coin's price for a place that wants it on one line. */
export function PriceNow({ coin }: { coin: CoinView }) {
  return <CoinPrice micro={coin.microLamportsPerCoin} />;
}
