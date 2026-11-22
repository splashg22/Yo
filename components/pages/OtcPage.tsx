"use client";

import { Choice } from "../ui/controls";
import { useCallback, useEffect, useState } from "react";
import { sessionApi, signedApi } from "@/lib/client/api";
import { COIN_DECIMALS, SOL_DECIMALS } from "@/lib/constants";
import type { Offer } from "@/lib/contract";
import { formatAmount, formatSol, formatTime, parseAmount } from "@/lib/format";
import { Address } from "../ui/Address";
import { Confirm } from "../ui/Confirm";
import { useCoins } from "../ui/useCoins";
import { useRun } from "../ui/useRun";
import { WalletGate } from "../wallet/WalletGate";
import { useWallet } from "../wallet/WalletProvider";
import { NeedsRing } from "../ui/NeedsRing";
import { AppPage } from "./shell";

export function OtcPage() {
  return (
    <AppPage
      label="OTC"
      title="Sell a block to a named buyer"
      intro="Sell a block to one named buyer: coin and payment change hands together, or nothing moves. Simulated in this build."
    >
      <NeedsRing>
        <WalletGate>
          <Desk />
        </WalletGate>
      </NeedsRing>
    </AppPage>
  );
}

type Reviewing = { kind: "offer" } | { kind: "accept"; offer: Offer } | null;
const EMPTY = { mint: "", amount: "", price: "", buyer: "" };

function Desk() {
  const { signer } = useWallet();
  const { coins, symbol } = useCoins();
  const { run, busy, line } = useRun();
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [loadProblem, setLoadProblem] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [formProblem, setFormProblem] = useState("");
  const [reviewing, setReviewing] = useState<Reviewing>(null);
  const me = signer!;
  const mint = form.mint || coins?.[0]?.mint || "";

  const refresh = useCallback(async () => {
    try {
      setOffers((await sessionApi("otc/mine", me)).offers);
      setLoadProblem("");
    } catch (error) {
      setLoadProblem(error instanceof Error ? error.message : String(error));
    }
  }, [me]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 7000);
    return () => clearInterval(timer);
  }, [refresh]);

  const terms = (offer: Offer) => `${formatAmount(offer.amount, COIN_DECIMALS)} ${symbol(offer.mint)} for ${formatSol(offer.priceLamports, 9)}`;
  const review = () => {
    try {
      parseAmount(form.amount, COIN_DECIMALS);
      parseAmount(form.price, SOL_DECIMALS);
      if (!form.buyer.trim()) throw new Error("enter the buyer's wallet address");
      setFormProblem("");
      setReviewing({ kind: "offer" });
    } catch (error) {
      setFormProblem(error instanceof Error ? error.message : String(error));
    }
  };
  const offer = () =>
    run("Sending the offer", async () => {
      await signedApi("otc/offer", me, {
        buyer: form.buyer.trim(),
        mint,
        amount: parseAmount(form.amount, COIN_DECIMALS).toString(),
        priceLamports: parseAmount(form.price, SOL_DECIMALS).toString(),
      });
      setReviewing(null);
      setForm(EMPTY);
      await refresh();
      return { message: "Offer sent. Only you and the buyer can see it." };
    });
  const accept = (accepted: Offer) =>
    run("Settling", async () => {
      await signedApi("otc/accept", me, { id: accepted.id });
      setReviewing(null);
      await refresh();
      return { message: "Settled. The block is in your Ring balance." };
    });
  const cancel = (cancelled: Offer) =>
    run("Cancelling", async () => {
      await signedApi("otc/cancel", me, { id: cancelled.id });
      await refresh();
      return { message: "Offer cancelled." };
    });

  if (reviewing?.kind === "offer") {
    return (
      <Confirm actions={["otc"]} label="Sign and offer" busy={busy} onConfirm={() => void offer()} onCancel={() => setReviewing(null)}>
        <p className="body">
          Offer {form.amount.trim()} {symbol(mint)} for {form.price.trim()} SOL to <span className="address">{form.buyer.trim()}</span>.
        </p>
        {line}
      </Confirm>
    );
  }
  if (reviewing?.kind === "accept") {
    const accepted = reviewing.offer;
    return (
      <Confirm actions={["otc"]} label="Sign and buy" busy={busy} onConfirm={() => void accept(accepted)} onCancel={() => setReviewing(null)}>
        <p className="body">
          Buy {terms(accepted)} from <span className="address">{accepted.seller}</span>.
        </p>
        {line}
      </Confirm>
    );
  }
  const expired = (candidate: Offer) => candidate.status === "open" && Date.now() > candidate.expiresAt;
  return (
    <>
      <h2 className="h3">New offer</h2>
      {coins === null ? (
        <p className="body">Reading the chain.</p>
      ) : coins.length === 0 ? (
        <p className="body">There is no coin to sell yet.</p>
      ) : (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            review();
          }}
        >
          <div className="pair">
            <div className="field">
              <label className="label" htmlFor="o-coin">
                Coin
              </label>
              <Choice
                id="o-coin"
                label="Coin"
                value={mint}
                onChange={(chosen) => setForm({ ...form, mint: chosen })}
                options={coins.map((coin) => ({ value: coin.mint, label: coin.symbol }))}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="o-amount">
                Size
              </label>
              <input
                id="o-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.0"
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="o-price">
              Price for the whole block, in SOL
            </label>
            <input
              id="o-price"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.0"
              value={form.price}
              onChange={(event) => setForm({ ...form, price: event.target.value })}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="o-buyer">
              Buyer&apos;s wallet address
            </label>
            <input
              id="o-buyer"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              value={form.buyer}
              onChange={(event) => setForm({ ...form, buyer: event.target.value })}
            />
          </div>
          <div className="actions">
            <button className="btn" type="submit">
              Review
            </button>
          </div>
          {formProblem && (
            <p className="status-line bad" role="alert">
              {formProblem}
            </p>
          )}
        </form>
      )}
      {line}
      <h2 className="h3">Your offers</h2>
      {loadProblem && (
        <p className="notice" role="alert">
          Your offers could not be read: {loadProblem}
        </p>
      )}
      <ul className="events">
        {offers === null && !loadProblem && <li className="pub">Reading your offers.</li>}
        {offers?.length === 0 && <li className="pub">None yet. Offers addressed to you appear here.</li>}
        {offers?.map((listed) => (
          <li key={listed.id}>
            <b>
              {listed.seller === me.address ? "You sell" : "You are offered"} {terms(listed)}
            </b>
            <span className="pub">
              {listed.seller === me.address ? "Buyer" : "Seller"} <Address value={listed.seller === me.address ? listed.buyer : listed.seller} short />
            </span>
            <span className="label">
              {expired(listed) ? "Expired" : listed.status === "open" ? `Open until ${formatTime(listed.expiresAt)}` : listed.status}
            </span>
            {listed.status === "open" && !expired(listed) && (
              <span className="actions">
                {listed.buyer === me.address && (
                  <button className="link" type="button" disabled={busy} onClick={() => setReviewing({ kind: "accept", offer: listed })}>
                    Accept
                  </button>
                )}
                {listed.seller === me.address && (
                  <button className="link" type="button" disabled={busy} onClick={() => void cancel(listed)}>
                    Cancel
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
