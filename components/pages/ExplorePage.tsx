"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CoinView } from "@/lib/contract";
import { formatChange, formatCompact, formatShare } from "@/lib/format";
import { CoinPicture } from "../ui/CoinPicture";
import { Choice } from "../ui/controls";
import { CoinPrice, Sol, Time } from "../ui/Money";
import { useCoins } from "../ui/useCoins";
import { AppPage } from "./shell";

const bigger = (a: string, b: string): number => (BigInt(b) > BigInt(a) ? 1 : BigInt(b) < BigInt(a) ? -1 : 0);
const ORDERS = {
  newest: ["Newest first", (a: CoinView, b: CoinView) => b.createdAt - a.createdAt],
  cap: ["Largest market cap", (a: CoinView, b: CoinView) => bigger(a.marketCapLamports, b.marketCapLamports)],
  volume: ["Most traded in 24 hours", (a: CoinView, b: CoinView) => bigger(a.volume24hLamports, b.volume24hLamports)],
  holders: ["Most holders", (a: CoinView, b: CoinView) => b.holders - a.holders],
  ring: ["Most in Ring balances", (a: CoinView, b: CoinView) => b.privacy.shareInRingPartsPerMillion - a.privacy.shareInRingPartsPerMillion],
} as const;
type Order = keyof typeof ORDERS;
/** Coins listed before "Show more" is needed. */
const PAGE = 50;

/** Every coin the indexer follows, as one table that can be searched and ordered. The live board is the Terminal. */
export function ExplorePage() {
  const { coins: all, problem, refresh } = useCoins(5000);
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<Order>("newest");
  const [shown, setShown] = useState(PAGE);
  const coins = useMemo(() => {
    if (all === null) return null;
    const wanted = query.trim().toLowerCase();
    // A name or ticker matches in any case; an address is case-sensitive, so it must match as typed.
    const matching = wanted ? all.filter((coin) => `${coin.name} ${coin.symbol}`.toLowerCase().includes(wanted) || coin.mint.includes(query.trim())) : all;
    return [...matching].sort(ORDERS[order][1]);
  }, [all, query, order]);
  return (
    <AppPage label="Explore" title="All coins" intro="Every coin the indexer follows, as a table. Figures are public facts read from the chain.">
      {problem && (
        <p className="notice" role="alert">
          The list could not be refreshed: {problem}{" "}
          <button className="link" type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </p>
      )}
      {coins === null && !problem && <p className="body">Reading what the indexer holds.</p>}
      {all !== null && all.length > 0 && (
        <div className="toolbar" style={{ padding: 0 }}>
          <div className="field-row search">
            <input
              id="e-search"
              type="search"
              autoComplete="off"
              aria-label="Find by name, ticker or address"
              placeholder="Name, ticker or address"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Choice
            id="e-order"
            label="Order"
            value={order}
            onChange={setOrder}
            options={Object.entries(ORDERS).map(([key, [label]]) => ({ value: key as Order, label }))}
          />
          <span className="quiet num" data-count>
            {coins?.length ?? 0} of {all.length}
          </span>
        </div>
      )}
      {all !== null && all.length > 0 && coins?.length === 0 && (
        <p className="body" role="status">
          No coin here matches &quot;{query.trim()}&quot;.{" "}
          <button className="link" type="button" onClick={() => setQuery("")}>
            Show all
          </button>
        </p>
      )}
      {all?.length === 0 && (
        <p className="body">
          No coin is followed here yet.{" "}
          <Link className="link" href="/launch">
            Launch the first
          </Link>
        </p>
      )}
      {coins !== null && coins.length > 0 && (
        <div className="table-wrap">
          <table className="grid" data-coins>
            <thead>
              <tr>
                <th>Coin</th>
                <th className="r">Price</th>
                <th className="r">Market cap</th>
                <th className="r">Volume, 24h</th>
                <th className="r mono">5m</th>
                <th className="r mono">1h</th>
                <th className="r mono">24h</th>
                <th className="r">Holders</th>
                <th className="r">Trades</th>
                <th className="r">Curve sold</th>
                <th className="r">In Ring balances</th>
                <th className="r">Age</th>
              </tr>
            </thead>
            <tbody>
              {coins.slice(0, shown).map((coin) => (
                <tr key={coin.mint} data-coin={coin.mint}>
                  <td>
                    <Link href={`/coin/${coin.mint}`} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                      <CoinPicture image={coin.image} symbol={coin.symbol} size={24} />
                      <b className="px">{coin.symbol}</b>
                      <span className="quiet wrap-anywhere">{coin.name}</span>
                    </Link>
                  </td>
                  <td className="r">
                    <CoinPrice micro={coin.microLamportsPerCoin} />
                  </td>
                  <td className="r" data-cap>
                    <Sol lamports={coin.marketCapLamports} compact />
                  </td>
                  <td className="r">
                    <Sol lamports={coin.volume24hLamports} compact />
                  </td>
                  <Change bps={coin.change.m5} />
                  <Change bps={coin.change.h1} />
                  <Change bps={coin.change.h24} />
                  <td className="r num">{formatCompact(coin.holders)}</td>
                  <td className="r num">{formatCompact(coin.trades)}</td>
                  <td className="r num">{coin.complete ? "Graduated" : formatShare(coin.progressBps * 100)}</td>
                  <td
                    className="r num"
                    data-ring
                    title={`${coin.privacy.walletsThatDeposited} wallet${coin.privacy.walletsThatDeposited === 1 ? " has" : "s have"} deposited it`}
                  >
                    {formatShare(coin.privacy.shareInRingPartsPerMillion)} · {coin.privacy.walletsThatDeposited}
                  </td>
                  <td className="r">
                    <Time at={coin.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {coins !== null && coins.length > shown && (
        <div className="actions">
          <button className="btn" type="button" onClick={() => setShown(shown + PAGE)}>
            Show {Math.min(PAGE, coins.length - shown)} more
          </button>
          <span className="label">
            {shown} of {coins.length} shown
          </span>
        </div>
      )}
      <p className="note-line">
        &quot;In Ring balances&quot; is the share of the supply held in Ring balances and the number of wallets that have deposited the coin: two public facts,
        not a rating.
      </p>
    </AppPage>
  );
}

function Change({ bps }: { bps: number | null }) {
  return <td className={`r num ${bps !== null && bps < 0 ? "down" : ""}`}>{bps === null ? <span className="quiet">None</span> : formatChange(bps)}</td>;
}
