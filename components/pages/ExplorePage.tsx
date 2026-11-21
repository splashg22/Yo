"use client";

import Link from "next/link";
import { formatChange, formatSol } from "@/lib/format";
import { Address } from "../ui/Address";
import { RingBadge } from "../ui/RingBadge";
import { useCoins } from "../ui/useCoins";
import { AppPage } from "./shell";

const DAY_MS = 86_400_000;
export const changeLabel = (since: number): string => (Date.now() - since < DAY_MS - 60_000 ? "Since launch" : "24 hours");

export function ExplorePage() {
  const { coins, problem, refresh } = useCoins(5000);
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
      {coins?.length === 0 && (
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
