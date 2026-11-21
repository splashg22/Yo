"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, signAndSend } from "@/lib/client/api";
import { formatAmount, parseAmount } from "@/lib/units";
import { Address, Confirm, RingBadge, sol, useRun, type CoinView } from "../ui";
import { WalletGate, useWallet } from "../Wallet";
import { AppPage } from "./shell";

export function CoinPage({ mint }: { mint: string }) {
  const [coin, setCoin] = useState<CoinView | null>(null);
  const [missing, setMissing] = useState(false);
  const refresh = useCallback(() => api<CoinView>("coin", { mint }).then(setCoin).catch(() => setMissing(true)), [mint]);
  useEffect(() => { void refresh(); const t = setInterval(refresh, 6000); return () => clearInterval(t); }, [refresh]);

  if (missing) return <AppPage label="Coin" title="Not launched here" intro="This address is not a coin that was launched through this site."><Link className="btn" href="/explore">Back to Explore</Link></AppPage>;
  return (
    <AppPage label={coin?.symbol ?? "Coin"} title={coin?.name ?? "Reading the chain"} intro="Buying and selling happens on the public bonding curve: your wallet, the amount and the price are visible to everyone.">
      {coin && (
        <>
          <dl className="kv">
            <dt>Coin address</dt><dd><Address value={coin.mint} /></dd>
            <dt>Creator</dt><dd><Address value={coin.creator} short /></dd>
            <dt>Market cap</dt><dd className="num">{sol(coin.marketCapLamports, 3)}</dd>
            <dt>Price</dt><dd className="num">{(coin.priceLamports / 1e9).toFixed(9)} SOL</dd>
            <dt>{Date.now() - coin.changeSince < 86_000_000 ? "Change since launch" : "Change, 24 hours"}</dt><dd className="num">{coin.changePercent >= 0 ? "+" : ""}{coin.changePercent.toFixed(2)}%</dd>
            <dt>In the Ring</dt><dd><RingBadge privacy={coin.privacy} /></dd>
          </dl>
          <p className="body">The Ring figures count what is public: the coin&apos;s total held in Ring balances, and wallets that made a deposit. How that total is split between holders is encrypted, so the number of holders inside the Ring cannot be known.</p>
          {coin.complete ? <p className="notice">This curve has completed. Trading has moved off the bonding curve.</p> : <WalletGate><Trade coin={coin} onDone={refresh} /></WalletGate>}
        </>
      )}
    </AppPage>
  );
}

function Trade({ coin, onDone }: { coin: CoinView; onDone(): void }) {
  const { signer } = useWallet();
  const { run, busy, line } = useRun();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState<"trade" | "fees" | null>(null);
  const [claimable, setClaimable] = useState("0");
  const [toRing, setToRing] = useState(true);
  const me = signer!;
  const isCreator = me.address === coin.creator;
  useEffect(() => { if (isCreator) api<{ lamports: string }>("fees/claimable", { wallet: me.address }).then((r) => setClaimable(r.lamports)).catch(() => undefined); }, [isCreator, me.address, coin.priceLamports]);

  const trade = () => run("Signing…", async () => {
    const value = parseAmount(amount, side === "buy" ? 9 : 6).toString();
    const built = await api("trade/build", { wallet: me.address, mint: coin.mint, side, amount: value });
    await signAndSend(me, built.transaction);
    setConfirming(null); setAmount(""); onDone();
    return side === "buy" ? `Bought about ${formatAmount(built.expected, 6, 2)} ${coin.symbol}. It is in your wallet, in public.` : `Sold for about ${formatAmount(built.expected, 9, 6)} SOL.`;
  });
  const claim = () => run("Signing…", async () => {
    const built = await api("fees/build", { wallet: me.address, toRing });
    const signature = await signAndSend(me, built.transaction);
    if (toRing) await api("ring/credit", { signature });
    setConfirming(null); setClaimable("0");
    return `Claimed ${formatAmount(built.claimable, 9, 6)} SOL${toRing ? " into your Ring balance" : ""}.`;
  });

  if (confirming === "trade") return <Confirm actions={["curve-trade"]} label={`Sign and ${side}`} busy={busy} onConfirm={trade} onCancel={() => setConfirming(null)}><p className="body">{side === "buy" ? `Buy ${coin.symbol} with ${amount} SOL` : `Sell ${amount} ${coin.symbol}`} on the curve.</p>{line}</Confirm>;
  if (confirming === "fees") return <Confirm actions={toRing ? ["creator-fees"] : ["curve-trade"]} label="Sign and claim" busy={busy} onConfirm={claim} onCancel={() => setConfirming(null)}><p className="body">Claim {formatAmount(claimable, 9, 6)} SOL of creator fees.</p>{line}</Confirm>;
  return (
    <>
      <div className="tabs" role="group" aria-label="Side">
        {(["buy", "sell"] as const).map((s) => <button key={s} aria-pressed={side === s} onClick={() => setSide(s)}>{s}</button>)}
      </div>
      <div className="form">
        <div className="field"><label className="label" htmlFor="t-amount">{side === "buy" ? "SOL to spend" : `${coin.symbol} to sell`}</label>
          <input id="t-amount" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="actions">
          <button className="btn" disabled={!amount} onClick={() => setConfirming("trade")}>Review</button>
          <Link className="link" href="/wallet">Move it into your Ring balance</Link>
        </div>
      </div>
      {isCreator && (
        <div className="form">
          <h2 className="h3">Creator fees</h2>
          <p className="body">{claimable === "0" ? "Nothing to claim yet. Fees build up as people trade." : `${formatAmount(claimable, 9, 6)} SOL to claim, across your coins.`}</p>
          <label className="check"><input type="checkbox" checked={toRing} onChange={(e) => setToRing(e.target.checked)} /><span>Send the claim straight to my Ring balance. The claim and its amount are public either way.</span></label>
          <div className="actions"><button className="btn" disabled={claimable === "0"} onClick={() => setConfirming("fees")}>Review</button></div>
        </div>
      )}
      {line}
    </>
  );
}
