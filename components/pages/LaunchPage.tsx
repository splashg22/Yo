"use client";

import Link from "next/link";
import { useState } from "react";
import { api, signAndSend } from "@/lib/client/api";
import { newActor } from "@/lib/keys";
import { formatAmount, parseAmount } from "@/lib/units";
import { Address, Confirm, useRun } from "../ui";
import { WalletGate, useWallet } from "../Wallet";
import { AppPage } from "./shell";

export function LaunchPage() {
  return (
    <AppPage label="Launch" title="Create a coin and register it with a Ring" intro="One signature creates the coin on a pump.fun bonding curve and registers its mint with the Ring, so holders can move it with encrypted amounts from the first block.">
      <WalletGate><Inner /></WalletGate>
    </AppPage>
  );
}

function Inner() {
  const { signer } = useWallet();
  const { run, busy, line } = useRun();
  const [form, setForm] = useState({ name: "", symbol: "", firstBuy: "", toRing: true });
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<{ mint: string; tokens: string } | null>(null);
  const me = signer!;
  const buying = Number(form.firstBuy) > 0;

  const launch = () => run("Signing…", async () => {
    const mint = newActor(); // the new coin's own key; it signs once and is then discarded
    const firstBuyLamports = buying ? parseAmount(form.firstBuy, 9).toString() : undefined;
    const built = await api("launch/build", { wallet: me.address, mint: mint.address, name: form.name, symbol: form.symbol, firstBuyLamports, toRing: form.toRing });
    const signature = await signAndSend(me, built.transaction, [mint.seed]);
    await api("launch/record", { mint: mint.address, signature, name: form.name, symbol: form.symbol });
    setDone({ mint: mint.address, tokens: built.firstBuyTokens });
    setConfirming(false);
    return "Launched.";
  });

  if (done) {
    return (
      <>
        <h2 className="h3">{form.symbol.toUpperCase()} is on the curve and registered with the Ring</h2>
        <dl className="kv">
          <dt>Coin address</dt><dd><Address value={done.mint} /></dd>
          {done.tokens !== "0" && <><dt>First buy</dt><dd>{formatAmount(done.tokens, 6, 2)} {form.symbol.toUpperCase()} {form.toRing ? "in your Ring balance" : "in your wallet"}</dd></>}
        </dl>
        <div className="actions">
          <Link className="btn" href={`/coin/${done.mint}`}>Open the coin</Link>
          <button className="link" onClick={() => { setDone(null); setForm({ name: "", symbol: "", firstBuy: "", toRing: true }); }}>Launch another</button>
        </div>
      </>
    );
  }
  return confirming ? (
    <Confirm actions={["launch", ...(buying ? ["curve-trade"] : []), ...(buying && form.toRing ? ["deposit"] : [])]} label="Sign and launch" busy={busy} onConfirm={launch} onCancel={() => setConfirming(false)}>
      <p className="body">Launch {form.name} ({form.symbol.toUpperCase()}){buying ? ` with a first buy of ${form.firstBuy} SOL` : ""}.</p>
      {line}
    </Confirm>
  ) : (
    <div className="form">
      <div className="pair">
        <div className="field"><label className="label" htmlFor="l-name">Coin name</label><input id="l-name" maxLength={32} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="l-symbol">Ticker</label><input id="l-symbol" maxLength={10} value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} /></div>
      </div>
      <div className="field"><label className="label" htmlFor="l-buy">Your first buy, in SOL, optional</label><input id="l-buy" inputMode="decimal" placeholder="0.0" value={form.firstBuy} onChange={(e) => setForm({ ...form, firstBuy: e.target.value })} /></div>
      <label className="check"><input type="checkbox" checked={form.toRing} onChange={(e) => setForm({ ...form, toRing: e.target.checked })} /><span>Put my first buy straight into my Ring balance. The buy itself is public either way.</span></label>
      <div className="actions"><button className="btn" disabled={!form.name.trim() || !form.symbol.trim()} onClick={() => setConfirming(true)}>Review</button></div>
      {line}
    </div>
  );
}
