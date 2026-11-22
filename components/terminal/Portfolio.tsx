"use client";

/**
 * A wallet's portfolio: what it holds in public, what each position cost and is worth, and the profit so far.
 * All of it is worked out from trades the indexer has stored, so any wallet can be looked up, not only one's own:
 * everything here is public on the chain.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { subscribe } from "@/lib/client/live";
import { COIN_DECIMALS, NATIVE } from "@/lib/constants";
import type { PositionView } from "@/lib/contract";
import { formatAmount, formatChange, formatCompact } from "@/lib/format";
import { CoinPicture } from "../ui/CoinPicture";
import { Sol, Time } from "../ui/Money";
import { useWallet } from "../wallet/WalletProvider";
import { LiveStrip } from "./LiveStrip";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function Portfolio() {
  const { signer } = useWallet();
  const [looked, setLooked] = useState("");
  const [typed, setTyped] = useState("");
  // The wallet looked at is kept after the # of the address, so the page can be reloaded or shared.
  useEffect(() => {
    const read = () => setLooked(ADDRESS.test(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "");
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const wallet = looked || signer?.address || "";

  const [positions, setPositions] = useState<PositionView[] | null>(null);
  const [sol, setSol] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const load = useCallback(async () => {
    if (!wallet) return;
    try {
      const [mine, held] = await Promise.all([api("portfolio", { wallet }), api("wallet/public", { wallet })]);
      setPositions(mine.positions);
      setSol(held.balances[NATIVE] ?? "0");
      setProblem("");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, [wallet]);
  useEffect(() => {
    setPositions(null);
    setSol(null);
    if (!wallet) return;
    void load();
    // A trade or a change of balance for this wallet arrives on its own channel; the figures are read again a moment later.
    let soon: ReturnType<typeof setTimeout> | undefined;
    const stop = subscribe(`wallet:${wallet}`, undefined, {
      events: () => {
        clearTimeout(soon);
        soon = setTimeout(() => void load(), 400);
      },
      reset: () => void load(),
    });
    // Prices move without this wallet trading: the worth of what is held is read again every so often.
    const timer = setInterval(() => !document.hidden && void load(), 15_000);
    return () => {
      stop();
      clearTimeout(soon);
      clearInterval(timer);
    };
  }, [wallet, load]);

  const total = (pick: (position: PositionView) => string): bigint => (positions ?? []).reduce((sum, position) => sum + BigInt(pick(position)), 0n);
  const [value, bought, realised, unrealised] = [
    total((position) => position.valueLamports),
    total((position) => position.boughtLamports),
    total((position) => position.realisedLamports),
    total((position) => position.unrealisedLamports),
  ];
  const profit = realised + unrealised;

  return (
    <>
      <div className="app">
        <header className="app-head">
          <h1 className="h3">Portfolio</h1>
          <p>Public holdings and trades of one wallet. Ring balances are not shown here: they are on the Ring wallet page.</p>
        </header>
        <form
          className="toolbar"
          style={{ padding: 0 }}
          onSubmit={(event) => {
            event.preventDefault();
            if (ADDRESS.test(typed.trim())) window.location.hash = typed.trim();
            else setProblem("That is not a wallet address.");
          }}
        >
          <div className="field-row search">
            <input aria-label="Look up any wallet" placeholder="Look up any wallet address" value={typed} onChange={(event) => setTyped(event.target.value)} />
          </div>
          <button className="btn" type="submit">
            Look up
          </button>
          {looked && (
            <button
              className="link"
              type="button"
              onClick={() => {
                history.replaceState(null, "", window.location.pathname);
                setLooked("");
                setTyped("");
              }}
            >
              {signer ? "Back to my wallet" : "Clear"}
            </button>
          )}
        </form>
        {problem && (
          <p className="notice" role="alert">
            {problem}
          </p>
        )}
        {!wallet ? (
          <p className="body">
            Look up a wallet above, or{" "}
            <Link className="link" href="/wallet">
              open your wallet
            </Link>{" "}
            to see your own.
          </p>
        ) : (
          <>
            <div className="figures" style={{ gap: "8px 40px" }} data-totals>
              <Total label="Wallet">
                <span className="address" title={wallet}>
                  {wallet.slice(0, 6)}…{wallet.slice(-6)}
                </span>
                {wallet === signer?.address && <span className="tag">You</span>}
              </Total>
              <Total label="SOL, public">{sol === null ? "Reading" : <Sol lamports={sol} />}</Total>
              <Total label="Coins, worth now">{positions === null ? "Reading" : <Sol lamports={value} />}</Total>
              <Total label="Spent buying">{positions === null ? "Reading" : <Sol lamports={bought} />}</Total>
              <Total label="Profit so far">
                {positions === null ? (
                  "Reading"
                ) : (
                  <span className={profit < 0n ? "down" : "up"}>
                    {profit > 0n ? "+" : ""}
                    <Sol lamports={profit} />
                    {bought > 0n && <span className="quiet"> {formatChange(Number((profit * 10_000n) / bought))}</span>}
                  </span>
                )}
              </Total>
            </div>
            <section className="block" aria-label="Positions">
              <h2 className="label">Positions</h2>
              {positions === null ? (
                <p className="body">Reading the trades the indexer holds for this wallet.</p>
              ) : positions.length === 0 ? (
                <p className="body">
                  This wallet has not traded a coin the indexer follows, and holds none.{" "}
                  <Link className="link" href="/terminal">
                    Open the board
                  </Link>
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="grid">
                    <thead>
                      <tr>
                        <th>Coin</th>
                        <th className="r">Holds</th>
                        <th className="r">Worth now</th>
                        <th className="r">Bought</th>
                        <th className="r">Sold</th>
                        <th className="r">Taken out</th>
                        <th className="r">Still in</th>
                        <th className="r">Profit</th>
                        <th className="r">Last trade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((position) => {
                        const gained = BigInt(position.realisedLamports) + BigInt(position.unrealisedLamports);
                        const cost = BigInt(position.boughtLamports);
                        return (
                          <tr key={position.mint} data-position={position.mint}>
                            <td>
                              <Link href={`/coin/${position.mint}`} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                                <CoinPicture image={position.image} symbol={position.symbol} size={24} />
                                <b className="px">{position.symbol || "Unnamed"}</b>
                                <span className="quiet">{position.name}</span>
                              </Link>
                            </td>
                            <td className="r num" title={formatAmount(position.held, COIN_DECIMALS)}>
                              {formatCompact(Number(position.held) / 10 ** COIN_DECIMALS)}
                            </td>
                            <td className="r">
                              <Sol lamports={position.valueLamports} />
                            </td>
                            <td className="r">
                              <Sol lamports={position.boughtLamports} /> <span className="quiet num">×{position.buys}</span>
                            </td>
                            <td className="r">
                              <Sol lamports={position.soldLamports} /> <span className="quiet num">×{position.sells}</span>
                            </td>
                            <td className={`r ${BigInt(position.realisedLamports) < 0n ? "down" : ""}`}>
                              <Sol lamports={position.realisedLamports} />
                            </td>
                            <td className={`r ${BigInt(position.unrealisedLamports) < 0n ? "down" : ""}`}>
                              <Sol lamports={position.unrealisedLamports} />
                            </td>
                            <td className={`r ${gained < 0n ? "down" : "up"}`}>
                              <span className="num">{cost > 0n ? formatChange(Number((gained * 10_000n) / cost)) : "No cost"}</span>
                            </td>
                            <td className="r">{position.lastTradeAt > 0 ? <Time at={position.lastTradeAt} /> : <span className="quiet">None here</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="note-line">
                &quot;Taken out&quot; is what sales fetched, less what those coins cost at the average buy price. &quot;Still in&quot; is what the coins held
                would fetch at the price now, less what they cost. Both are before network fees and price impact. Coins that arrived by a transfer, or out of a
                Ring balance, have no cost here.
              </p>
            </section>
          </>
        )}
      </div>
      <LiveStrip />
    </>
  );
}

function Total({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      <span className="v" style={{ fontSize: 16 }}>
        {children}
      </span>
    </div>
  );
}
