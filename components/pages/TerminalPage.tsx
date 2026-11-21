"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, signAndSend } from "@/lib/client/api";
import { COIN_DECIMALS, NATIVE, SOL_DECIMALS } from "@/lib/constants";
import type { CoinView } from "@/lib/contract";
import { formatAmount, formatChange, formatCoin, formatPrice, formatSol, parseAmount } from "@/lib/format";
import { PrivacyPanel } from "../PrivacyPanel";
import { ActivityList } from "../ui/ActivityList";
import { Address } from "../ui/Address";
import { CoinPicture } from "../ui/CoinPicture";
import { PriceChart } from "../ui/PriceChart";
import { RingBadge } from "../ui/RingBadge";
import { useCoins } from "../ui/useCoins";
import { useRun } from "../ui/useRun";
import { WalletGate } from "../wallet/WalletGate";
import { useWallet } from "../wallet/WalletProvider";

const QUICK_BUYS = ["0.01", "0.05", "0.1"] as const;
const QUICK_SELLS = [25, 50, 100] as const;
/** Kept back on a buy for the network fee and the rent of the coin's account, so a buy the wallet cannot pay for is never sent. */
const BUY_RESERVE_LAMPORTS = 3_000_000n;

/**
 * One screen for trading on the curve: the board of coins launched here, the chosen coin's price and
 * activity, and a trade panel. Everything on it is a public curve trade. Nothing here is a Ring transfer.
 */
export function TerminalPage() {
  const { coins, problem, refresh } = useCoins(3000);
  const [chosen, setChosen] = useState<string | null>(null);
  // The chosen coin is kept after the # of the address, so a reload or a shared link opens on the same coin.
  useEffect(() => {
    const read = () => setChosen(window.location.hash.slice(1) || null);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const choose = (mint: string) => {
    window.history.replaceState(null, "", `#${mint}`);
    setChosen(mint);
  };
  const coin = useMemo(() => coins?.find((candidate) => candidate.mint === chosen) ?? coins?.[0] ?? null, [coins, chosen]);

  return (
    <div className="terminal" data-bg-full>
      <header className="terminal-head">
        <span className="label">Terminal</span>
        <h1 className="h3">Trade coins on the curve</h1>
        <p className="body">
          The board lists coins launched on this site, not every coin on Solana. Every trade here is a public pump.fun trade: your wallet, the amount and the
          price are visible to everyone.
        </p>
      </header>
      {problem && (
        <p className="notice" role="alert">
          The board could not be refreshed: {problem}{" "}
          <button className="link" type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </p>
      )}
      <div className="terminal-grid">
        <section aria-labelledby="t-board">
          <h2 className="label" id="t-board">
            Board
          </h2>
          {coins === null && !problem && <p className="body">Reading the chain.</p>}
          {coins?.length === 0 && (
            <p className="body">
              No coin has been launched here yet.{" "}
              <Link className="link" href="/launch">
                Launch the first
              </Link>
            </p>
          )}
          <ul className="board">
            {coins?.map((listed) => (
              <li key={listed.mint}>
                <button type="button" aria-pressed={coin?.mint === listed.mint} onClick={() => choose(listed.mint)}>
                  <CoinPicture image={listed.image} symbol={listed.symbol} size={32} />
                  <span className="board-name">
                    <b>{listed.symbol}</b>
                    <span className="label wrap-anywhere">{listed.name}</span>
                  </span>
                  <span className="board-figures num">
                    <span>{formatSol(listed.marketCapLamports, 2)}</span>
                    <span className="label">{formatChange(listed.changeBasisPoints)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="t-coin">
          <h2 className="label" id="t-coin">
            Coin
          </h2>
          {coin ? <Chosen coin={coin} /> : coins !== null && coins.length > 0 ? <p className="body">Choose a coin from the board.</p> : null}
        </section>

        <section aria-labelledby="t-trade">
          <h2 className="label" id="t-trade">
            Trade
          </h2>
          {coin ? (
            coin.complete ? (
              <p className="notice">This curve has completed, so the coin no longer trades on the bonding curve.</p>
            ) : (
              <WalletGate>
                <TradePanel key={coin.mint} coin={coin} onDone={refresh} />
              </WalletGate>
            )
          ) : (
            <p className="body">Nothing to trade yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Chosen({ coin }: { coin: CoinView }) {
  const loadActivity = useCallback(() => api("coin/activity", { mint: coin.mint }), [coin.mint]);
  return (
    <>
      <div className="coin-head">
        <CoinPicture image={coin.image} symbol={coin.symbol} />
        <div>
          <Link href={`/coin/${coin.mint}`}>
            <b className="h3 wrap-anywhere">{coin.name}</b> <span className="label">{coin.symbol}</span>
          </Link>
          <br />
          <Address value={coin.mint} short />
        </div>
      </div>
      <dl className="kv">
        <dt>Price of one coin</dt>
        <dd className="num">{formatPrice(coin.microLamportsPerCoin)}</dd>
        <dt>Market cap</dt>
        <dd className="num">{formatSol(coin.marketCapLamports, 3)}</dd>
        <dt>In the Ring</dt>
        <dd>
          <RingBadge privacy={coin.privacy} />
        </dd>
      </dl>
      <PriceChart mint={coin.mint} version={coin.microLamportsPerCoin} />
      <h3 className="label">Recent activity on the curve</h3>
      <ActivityList load={loadActivity} version={coin.marketCapLamports} empty="Nothing yet." />
    </>
  );
}

function TradePanel({ coin, onDone }: { coin: CoinView; onDone: () => Promise<void> }) {
  const { signer } = useWallet();
  const me = signer!;
  const { run, busy, line } = useRun();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [held, setHeld] = useState<Record<string, string> | null>(null);
  const [problem, setProblem] = useState("");

  const readHeld = useCallback(async () => {
    try {
      setHeld((await api("wallet/public", { wallet: me.address })).balances);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, [me.address]);
  useEffect(() => {
    void readHeld();
  }, [readHeld]);
  const coinsHeld = BigInt(held?.[coin.mint] ?? "0");
  const solHeld = BigInt(held?.[NATIVE] ?? "0");
  const affords = (lamports: bigint) => held !== null && solHeld >= lamports + BUY_RESERVE_LAMPORTS;

  /** One click: build, sign with the key in this browser, send. The panel above the button has already said what it makes public. */
  const trade = (tradeSide: "buy" | "sell", baseUnits: bigint) =>
    run("Waiting for the chain to confirm", async () => {
      const built = await api("trade/build", { wallet: me.address, mint: coin.mint, side: tradeSide, amount: baseUnits.toString() });
      const sent = await signAndSend(me, built.transaction);
      setAmount("");
      await Promise.all([readHeld(), onDone()]);
      return {
        message:
          tradeSide === "buy"
            ? `Bought about ${formatAmount(built.expected, COIN_DECIMALS, 2)} ${coin.symbol}. It is in your wallet, in public.`
            : `Sold for about ${formatSol(built.expected, 6)}.`,
        signature: sent.signature,
      };
    });
  const submit = () => {
    try {
      setProblem("");
      const baseUnits = parseAmount(amount, side === "buy" ? SOL_DECIMALS : COIN_DECIMALS);
      if (side === "buy" && !affords(baseUnits)) throw new Error("Your wallet holds too little SOL for that buy and its fees.");
      if (side === "sell" && baseUnits > coinsHeld) throw new Error(`Your wallet holds less ${coin.symbol} than that.`);
      void trade(side, baseUnits);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <dl className="kv">
        <dt>Your SOL, public</dt>
        <dd className="num">{held ? formatCoin(NATIVE, held[NATIVE] ?? "0") : "Reading"}</dd>
        <dt>Your {coin.symbol}, public</dt>
        <dd className="num">{held ? formatCoin(coin.mint, coinsHeld) : "Reading"}</dd>
      </dl>
      <PrivacyPanel action="curve-trade" />
      <p className="body">A trade here is sent as soon as you press a button. There is no second step: the panel above is the review.</p>
      <div className="tabs" role="group" aria-label="Side">
        {(["buy", "sell"] as const).map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={side === name}
            onClick={() => {
              setSide(name);
              setAmount("");
              setProblem("");
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="quick" role="group" aria-label={side === "buy" ? "Buy a set amount" : "Sell a share of what you hold"}>
        {side === "buy"
          ? QUICK_BUYS.map((sol) => (
              <button
                key={sol}
                className="btn"
                type="button"
                disabled={busy || !affords(parseAmount(sol, SOL_DECIMALS))}
                onClick={() => void trade("buy", parseAmount(sol, SOL_DECIMALS))}
              >
                Buy {sol} SOL
              </button>
            ))
          : QUICK_SELLS.map((percent) => (
              <button
                key={percent}
                className="btn"
                type="button"
                disabled={busy || coinsHeld === 0n}
                onClick={() => void trade("sell", (coinsHeld * BigInt(percent)) / 100n)}
              >
                Sell {percent}%
              </button>
            ))}
      </div>
      {side === "buy" && held !== null && !affords(parseAmount(QUICK_BUYS[0], SOL_DECIMALS)) && (
        <p className="body">
          Your wallet holds too little SOL to buy.{" "}
          <Link className="link" href="/wallet">
            Open your wallet
          </Link>
        </p>
      )}
      {side === "sell" && held !== null && coinsHeld === 0n && <p className="body">You hold none of this coin in your wallet, so there is nothing to sell.</p>}
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="field">
          <label className="label" htmlFor="tm-amount">
            {side === "buy" ? "Or another amount, in SOL" : `Or another amount, in ${coin.symbol}`}
          </label>
          <input id="tm-amount" inputMode="decimal" autoComplete="off" placeholder="0.0" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </div>
        <div className="actions">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Working" : side === "buy" ? "Buy now" : "Sell now"}
          </button>
          <Link className="link" href="/wallet">
            Move it into your Ring balance
          </Link>
        </div>
        {problem && (
          <p className="status-line bad" role="alert">
            {problem}
          </p>
        )}
      </form>
      {line}
    </>
  );
}
