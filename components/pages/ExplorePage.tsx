"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CoinView } from "@/lib/contract";
import { formatChange, formatSol } from "@/lib/format";
import { Address } from "../ui/Address";
import { RingBadge } from "../ui/RingBadge";
import { useCoins } from "../ui/useCoins";
import { AppPage } from "./shell";

const DAY_MS = 86_400_000;
export const changeLabel = (since: number): string => (Date.now() - since < DAY_MS - 60_000 ? "Since launch" : "24 hours");

const ORDERS = {
  newest: ["Newest first", (a: CoinView, b: CoinView) => b.createdAt - a.createdAt],
  cap: ["Largest market cap", (a: CoinView, b: CoinView) => (BigInt(b.marketCapLamports) > BigInt(a.marketCapLamports) ? 1 : -1)],
  ring: ["Most in Ring balances", (a: CoinView, b: CoinView) => b.privacy.shareInRingPartsPerMillion - a.privacy.shareInRingPartsPerMillion],
} as const;
type Order = keyof typeof ORDERS;

export function ExplorePage() {
  const { coins: all, problem, refresh } = useCoins(5000);
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<Order>("newest");
  const coins = useMemo(() => {
    if (all === null) return null;
    const wanted = query.trim().toLowerCase();
    // A name or ticker matches in any case; an address is case-sensitive, so it must match as typed.
    const matching = wanted ? all.filter((coin) => `${coin.name} ${coin.symbol}`.toLowerCase().includes(wanted) || coin.mint.includes(query.trim())) : all;
    return [...matching].sort(ORDERS[order][1]);
  }, [all, query, order]);
  return (
    <AppPage
      label="Explore"
      title="Every coin launched here"
      intro="Market cap is read from the bonding curve. The Ring line shows how much of the supply sits in Ring balances and how many wallets have deposited it. Both are public facts."
    >
      {problem && (
        <p className="notice" role="alert">
          The list could not be refreshed: {problem}{" "}
          <button className="link" type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </p>
      )}
      {coins === null && !problem && <p className="body">Reading the chain.</p>}
      {all !== null && all.length > 0 && (
        <div className="pair">
          <div className="field">
            <label className="label" htmlFor="e-search">
              Find by name, ticker or address
            </label>
            <input id="e-search" type="search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="e-order">
              Order
            </label>
            <select id="e-order" value={order} onChange={(event) => setOrder(event.target.value as Order)}>
              {Object.entries(ORDERS).map(([key, [label]]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
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
          No coin has been launched here yet.{" "}
          <Link className="link" href="/launch">
            Launch the first
          </Link>
        </p>
      )}
      {coins !== null && coins.length > 0 && (
        <ul className="coins">
          {coins.map((coin) => (
            <li key={coin.mint}>
              <div>
                <Link href={`/coin/${coin.mint}`}>
                  <b className="h3 wrap-anywhere">{coin.name}</b> <span className="label">{coin.symbol}</span>
                </Link>
                <br />
                <Address value={coin.mint} short />
              </div>
              <div className="figure num">
                <span className="label">Market cap</span>
                <br />
                {formatSol(coin.marketCapLamports, 2)}
              </div>
              <div className="figure num">
                <span className="label">{changeLabel(coin.changeSince)}</span>
                <br />
                {formatChange(coin.changeBasisPoints)}
              </div>
              <RingBadge privacy={coin.privacy} />
            </li>
          ))}
        </ul>
      )}
    </AppPage>
  );
}
