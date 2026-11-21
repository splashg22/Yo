"use client";

import Link from "next/link";
import { Address, RingBadge, sol, useCoins } from "../ui";
import { AppPage } from "./shell";

export function ExplorePage() {
  const { coins } = useCoins(5000);
  return (
    <AppPage label="Explore" title="Every coin launched here" intro="Market cap is read from the bonding curve. The Ring line shows how much of the supply sits in Ring balances and how many wallets have deposited it. Both are public facts.">
      {coins === null ? <p className="body">Reading the chain.</p> : coins.length === 0 ? (
        <p className="body">No coin has been launched here yet. <Link className="link" href="/launch">Launch the first</Link></p>
      ) : (
        <ul className="coins">
          {coins.map((coin) => (
            <li key={coin.mint}>
              <div>
                <Link href={`/coin/${coin.mint}`}><b className="h3">{coin.name}</b> <span className="label">{coin.symbol}</span></Link><br />
                <Address value={coin.mint} short />
              </div>
              <div className="figure num"><span className="label">Market cap</span><br />{sol(coin.marketCapLamports, 2)}</div>
              <div className="figure num"><span className="label">{Date.now() - coin.changeSince < 86_000_000 ? "Since launch" : "24 hours"}</span><br />{coin.changePercent >= 0 ? "+" : ""}{coin.changePercent.toFixed(2)}%</div>
              <RingBadge privacy={coin.privacy} />
            </li>
          ))}
        </ul>
      )}
    </AppPage>
  );
}
