"use client";

import { useCallback, useEffect, useState } from "react";
import { signedApi } from "@/lib/client/api";
import { formatAmount, parseAmount } from "@/lib/units";
import { Address, Confirm, useCoins, useRun } from "../ui";
import { WalletGate, useWallet } from "../Wallet";
import { AppPage } from "./shell";

interface Offer { id: string; seller: string; buyer: string; mint: string; amount: string; priceLamports: string; expiresAt: number; status: string }

export function OtcPage() {
  return (
    <AppPage label="OTC" title="Sell a block to a named buyer" intro="You name the buyer, the size and the price. When the buyer accepts, the coin and the payment change hands together inside the Ring, or nothing moves. Both must hold what they are giving in their Ring balances.">
      <WalletGate><Inner /></WalletGate>
    </AppPage>
  );
}

function Inner() {
  const { signer } = useWallet();
  const { coins, symbol } = useCoins();
  const { run, busy, line } = useRun();
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [form, setForm] = useState({ mint: "", amount: "", price: "", buyer: "" });
  const [confirming, setConfirming] = useState<{ kind: "offer" } | { kind: "accept"; offer: Offer } | null>(null);
  const me = signer!;
  const mint = form.mint || coins?.[0]?.mint || "";

  const refresh = useCallback(() => signedApi<{ offers: Offer[] }>("otc/mine", me).then((r) => setOffers(r.offers)).catch(() => undefined), [me]);
  useEffect(() => { void refresh(); const t = setInterval(refresh, 7000); return () => clearInterval(t); }, [refresh]);

  const describe = (o: Offer) => `${formatAmount(o.amount, 6)} ${symbol(o.mint)} for ${formatAmount(o.priceLamports, 9)} SOL`;
  const offer = () => run("Signing…", async () => {
    await signedApi("otc/offer", me, { buyer: form.buyer.trim(), mint, amount: parseAmount(form.amount, 6).toString(), priceLamports: parseAmount(form.price, 9).toString() });
    setConfirming(null); setForm({ mint: "", amount: "", price: "", buyer: "" }); await refresh();
    return "Offer sent. Only you and the buyer can see it.";
  });
  const accept = (o: Offer) => run("Signing…", async () => { await signedApi("otc/accept", me, { id: o.id }); setConfirming(null); await refresh(); return "Settled. The block is in your Ring balance."; });
  const cancel = (o: Offer) => run("Cancelling…", async () => { await signedApi("otc/cancel", me, { id: o.id }); await refresh(); return "Offer cancelled."; });

  if (confirming?.kind === "offer") return <Confirm actions={["otc"]} label="Sign and offer" busy={busy} onConfirm={offer} onCancel={() => setConfirming(null)}><p className="body">Offer {form.amount} {symbol(mint)} for {form.price} SOL to <span className="address">{form.buyer}</span>.</p>{line}</Confirm>;
  if (confirming?.kind === "accept") return <Confirm actions={["otc"]} label="Sign and buy" busy={busy} onConfirm={() => accept(confirming.offer)} onCancel={() => setConfirming(null)}><p className="body">Buy {describe(confirming.offer)} from <span className="address">{confirming.offer.seller}</span>.</p>{line}</Confirm>;

  return (
    <>
      <h2 className="h3">New offer</h2>
      {coins?.length === 0 ? <p className="body">There is no coin to sell yet.</p> : (
        <div className="form">
          <div className="pair">
            <div className="field"><label className="label" htmlFor="o-coin">Coin</label>
              <select id="o-coin" value={mint} onChange={(e) => setForm({ ...form, mint: e.target.value })}>{(coins ?? []).map((c) => <option key={c.mint} value={c.mint}>{c.symbol}</option>)}</select></div>
            <div className="field"><label className="label" htmlFor="o-amount">Size</label><input id="o-amount" inputMode="decimal" placeholder="0.0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          </div>
          <div className="field"><label className="label" htmlFor="o-price">Price for the whole block, in SOL</label><input id="o-price" inputMode="decimal" placeholder="0.0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
          <div className="field"><label className="label" htmlFor="o-buyer">Buyer&apos;s wallet address</label><input id="o-buyer" spellCheck={false} autoComplete="off" value={form.buyer} onChange={(e) => setForm({ ...form, buyer: e.target.value })} /></div>
          <div className="actions"><button className="btn" disabled={!form.amount || !form.price || !form.buyer} onClick={() => setConfirming({ kind: "offer" })}>Review</button></div>
        </div>
      )}
      {line}
      <h2 className="h3">Your offers</h2>
      <ul className="events">
        {offers?.length === 0 && <li className="pub">None yet. Offers addressed to you appear here.</li>}
        {offers?.map((o) => (
          <li key={o.id}>
            <b>{o.seller === me.address ? "You sell" : "You are offered"} {describe(o)}</b>
            <span className="pub">{o.seller === me.address ? "Buyer" : "Seller"} <Address value={o.seller === me.address ? o.buyer : o.seller} short /> · {o.status}</span>
            {o.status === "open" && (
              <span className="actions">
                {o.buyer === me.address && <button className="link" disabled={busy} onClick={() => setConfirming({ kind: "accept", offer: o })}>Accept</button>}
                {o.seller === me.address && <button className="link" disabled={busy} onClick={() => cancel(o)}>Cancel</button>}
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
