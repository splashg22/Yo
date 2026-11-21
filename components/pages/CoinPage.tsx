"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, signAndSend } from "@/lib/client/api";
import { COIN_DECIMALS, SOL_DECIMALS } from "@/lib/constants";
import type { CoinView } from "@/lib/contract";
import { formatAmount, formatChange, formatPrice, formatSol, formatTime, parseAmount } from "@/lib/format";
import { site } from "@/site.config";
import { ActivityList } from "../ui/ActivityList";
import { Address } from "../ui/Address";
import { CoinPicture } from "../ui/CoinPicture";
import { Confirm } from "../ui/Confirm";
import { PriceChart } from "../ui/PriceChart";
import { RingBadge } from "../ui/RingBadge";
import { useHashChoice } from "../ui/useHashChoice";
import { useRingOn } from "../ui/NeedsRing";
import { useRun } from "../ui/useRun";
import { WalletGate } from "../wallet/WalletGate";
import { useWallet } from "../wallet/WalletProvider";
import { changeLabel } from "./ExplorePage";
import { AppPage } from "./shell";

const SIDES = ["buy", "sell"] as const;

export function CoinPage({ mint }: { mint: string }) {
  const [coin, setCoin] = useState<CoinView | null>(null);
  const [problem, setProblem] = useState("");
  const refresh = useCallback(async () => {
    try {
      setCoin(await api("coin", { mint }));
      setProblem("");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, [mint]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 6000);
    return () => clearInterval(timer);
  }, [refresh]);
  const loadActivity = useCallback(() => api("coin/activity", { mint }), [mint]);
  // The tab is named after the coin once it is known, so several coin tabs can be told apart.
  useEffect(() => {
    if (coin) document.title = `${coin.name} (${coin.symbol}) · ${site.name}`;
  }, [coin]);

  if (!coin) {
    return (
      <AppPage
        label="Coin"
        title={problem ? "This coin could not be shown" : "Reading the chain"}
        intro="Buying and selling happens on the public bonding curve: your wallet, the amount and the price are visible to everyone."
      >
        {problem && (
          <>
            <p className="notice" role="alert">
              {problem}
            </p>
            <div className="actions">
              <button className="btn" type="button" onClick={() => void refresh()}>
                Try again
              </button>
              <Link className="link" href="/explore">
                Back to Explore
              </Link>
            </div>
          </>
        )}
      </AppPage>
    );
  }
  return (
    <AppPage
      label={`Coin, ticker ${coin.symbol}`}
      title={coin.name}
      intro="Buying and selling happens on the public bonding curve: your wallet, the amount and the price are visible to everyone."
    >
      {problem && (
        <p className="notice" role="alert">
          These figures may be out of date: {problem}
        </p>
      )}
      <CoinPicture image={coin.image} symbol={coin.symbol} size={96} />
      <dl className="kv">
        <dt>Coin address</dt>
        <dd>
          <Address value={coin.mint} />
        </dd>
        <dt>Creator</dt>
        <dd>
          <Address value={coin.creator} short />
        </dd>
        <dt>Launched</dt>
        <dd>
          {formatTime(coin.createdAt)}{" "}
          <Link className="link" href={`/tx/${coin.signature}`}>
            Receipt
          </Link>
        </dd>
        <dt>Market cap</dt>
        <dd className="num">{formatSol(coin.marketCapLamports, 3)}</dd>
        <dt>Price of one coin</dt>
        <dd className="num">{formatPrice(coin.microLamportsPerCoin)}</dd>
        <dt>{changeLabel(coin.changeSince)}</dt>
        <dd className="num">{formatChange(coin.changeBasisPoints)}</dd>
        <dt>In the Ring</dt>
        <dd>
          <RingBadge privacy={coin.privacy} />
        </dd>
      </dl>
      <p className="body">
        The Ring figures count what is public: the coin&apos;s total held in Ring balances, and wallets that made a deposit. How that total is split between
        holders is encrypted, so the number of holders inside the Ring cannot be known.
      </p>
      {coin.complete ? (
        <p className="notice">This curve has completed, so the coin no longer trades on the bonding curve. It can still be held and moved in Ring balances.</p>
      ) : (
        <WalletGate>
          <TradeAndFees coin={coin} onDone={refresh} />
        </WalletGate>
      )}
      <h2 className="h3">Price, as this site has read it</h2>
      <PriceChart mint={mint} version={coin.microLamportsPerCoin} />
      <h2 className="h3">Recent activity on the curve</h2>
      <p className="body">The latest transactions that touched this coin&apos;s bonding curve: its launch, and every buy and sell. All public.</p>
      {/* The market cap moves with every trade, so a change in it is the cue to read the list again. */}
      <ActivityList load={loadActivity} version={coin.marketCapLamports} empty="Nothing yet." />
    </AppPage>
  );
}

function TradeAndFees({ coin, onDone }: { coin: CoinView; onDone: () => Promise<void> }) {
  const { signer } = useWallet();
  const { run, busy, line } = useRun();
  const [side, setSide] = useHashChoice(SIDES);
  const [amount, setAmount] = useState("");
  const [problem, setProblem] = useState("");
  const [reviewing, setReviewing] = useState<"trade" | "fees" | null>(null);
  const [claimable, setClaimable] = useState<string | null>(null);
  const ringOn = useRingOn();
  const [wantsRing, setToRing] = useState(true);
  const toRing = ringOn && wantsRing;
  const me = signer!;
  const isCreator = me.address === coin.creator;
  const tradeDecimals = side === "buy" ? SOL_DECIMALS : COIN_DECIMALS;

  // Fees build up with every trade, so they are re-read whenever the price moves.
  useEffect(() => {
    if (!isCreator) return;
    api("fees/claimable", { wallet: me.address }).then(
      (result) => setClaimable(result.lamports),
      () => setClaimable(null),
    );
  }, [isCreator, me.address, coin.microLamportsPerCoin]);

  const review = () => {
    try {
      parseAmount(amount, tradeDecimals);
      setProblem("");
      setReviewing("trade");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };
  const trade = () =>
    run("Waiting for the chain to confirm", async () => {
      const built = await api("trade/build", { wallet: me.address, mint: coin.mint, side, amount: parseAmount(amount, tradeDecimals).toString() });
      const sent = await signAndSend(me, built.transaction);
      setReviewing(null);
      setAmount("");
      await onDone();
      return {
        message:
          side === "buy"
            ? `Bought about ${formatAmount(built.expected, COIN_DECIMALS, 2)} ${coin.symbol}. It is in your wallet, in public.`
            : `Sold for about ${formatSol(built.expected, 6)}.`,
        signature: sent.signature,
      };
    });
  const claim = () =>
    run("Waiting for the chain to confirm", async () => {
      const built = await api("fees/build", { wallet: me.address, toRing });
      const sent = await signAndSend(me, built.transaction);
      setReviewing(null);
      setClaimable("0");
      return { message: `Claimed ${formatSol(built.claimable, 6)}${toRing ? " into your Ring balance" : ""}.`, signature: sent.signature };
    });

  if (reviewing === "trade") {
    return (
      <Confirm actions={["curve-trade"]} label={`Sign and ${side}`} busy={busy} onConfirm={() => void trade()} onCancel={() => setReviewing(null)}>
        <p className="body">{side === "buy" ? `Buy ${coin.symbol} with ${amount.trim()} SOL` : `Sell ${amount.trim()} ${coin.symbol}`} on the curve.</p>
        {line}
      </Confirm>
    );
  }
  if (reviewing === "fees") {
    return (
      <Confirm
        actions={toRing ? ["creator-fees"] : ["curve-trade"]}
        label="Sign and claim"
        busy={busy}
        onConfirm={() => void claim()}
        onCancel={() => setReviewing(null)}
      >
        <p className="body">Claim {formatSol(claimable ?? "0", 6)} of creator fees.</p>
        {line}
      </Confirm>
    );
  }
  return (
    <>
      <div className="tabs" role="group" aria-label="Side">
        {SIDES.map((name) => (
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
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          review();
        }}
      >
        <div className="field">
          <label className="label" htmlFor="t-amount">
            {side === "buy" ? "SOL to spend" : `${coin.symbol} to sell`}
          </label>
          <input id="t-amount" inputMode="decimal" autoComplete="off" placeholder="0.0" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </div>
        <div className="actions">
          <button className="btn" type="submit">
            Review
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
      {isCreator && (
        <div className="form">
          <h2 className="h3">Creator fees</h2>
          <p className="body">
            {claimable === null
              ? "Reading what you can claim."
              : claimable === "0"
                ? "Nothing to claim yet. Fees build up as people trade."
                : `${formatSol(claimable, 6)} to claim, across your coins.`}
          </p>
          {ringOn && (
            <label className="check">
              <input type="checkbox" checked={toRing} onChange={(event) => setToRing(event.target.checked)} />
              <span>Send the claim straight to my Ring balance. The claim and its amount are public either way.</span>
            </label>
          )}
          <div className="actions">
            <button className="btn" type="button" disabled={claimable === null || claimable === "0"} onClick={() => setReviewing("fees")}>
              Review
            </button>
          </div>
        </div>
      )}
      {line}
    </>
  );
}
