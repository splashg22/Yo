"use client";

import Link from "next/link";
import { useState } from "react";
import { api, signAndSend } from "@/lib/client/api";
import { COIN_DECIMALS, SOL_DECIMALS } from "@/lib/constants";
import { formatAmount, parseAmount } from "@/lib/format";
import { newActor } from "@/lib/keys";
import { Address } from "../ui/Address";
import { Confirm } from "../ui/Confirm";
import { useRun } from "../ui/useRun";
import { WalletGate } from "../wallet/WalletGate";
import { useWallet } from "../wallet/WalletProvider";
import { AppPage } from "./shell";

export function LaunchPage() {
  return (
    <AppPage
      label="Launch"
      title="Create a coin and register it with a Ring"
      intro="One signature creates the coin on a pump.fun bonding curve and registers its mint with the Ring. The launch is public. From then on holders can keep it in a Ring balance."
    >
      <WalletGate>
        <LaunchForm />
      </WalletGate>
    </AppPage>
  );
}

interface Launched {
  mint: string;
  symbol: string;
  firstBuyTokens: string;
  toRing: boolean;
  signature: string;
}
const EMPTY = { name: "", symbol: "", firstBuy: "", toRing: true };

function LaunchForm() {
  const { signer } = useWallet();
  const { run, busy, line, clear } = useRun();
  const [form, setForm] = useState(EMPTY);
  const [reviewing, setReviewing] = useState(false);
  const [problem, setProblem] = useState("");
  const [launched, setLaunched] = useState<Launched | null>(null);
  const me = signer!;
  const buying = form.firstBuy.trim() !== "";

  const review = () => {
    try {
      if (!form.name.trim()) throw new Error("give the coin a name");
      if (!/^[A-Za-z0-9]{1,10}$/.test(form.symbol.trim())) throw new Error("the ticker must be 1 to 10 letters or digits");
      if (buying) parseAmount(form.firstBuy, SOL_DECIMALS);
      setProblem("");
      setReviewing(true);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  const launch = () =>
    run("Waiting for the chain to confirm", async () => {
      const mint = newActor(); // the new coin's own key: it signs this one transaction and is then discarded
      const built = await api("launch/build", {
        wallet: me.address,
        mint: mint.address,
        name: form.name.trim(),
        symbol: form.symbol.trim(),
        firstBuyLamports: buying ? parseAmount(form.firstBuy, SOL_DECIMALS).toString() : undefined,
        toRing: form.toRing,
      });
      const sent = await signAndSend(me, built.transaction, [mint.seed]);
      setLaunched({
        mint: mint.address,
        symbol: form.symbol.trim().toUpperCase(),
        firstBuyTokens: built.firstBuyTokens,
        toRing: form.toRing,
        signature: sent.signature,
      });
      setReviewing(false);
      return { message: "Launched.", signature: sent.signature };
    });

  if (launched) {
    return (
      <>
        <h2 className="h3">{launched.symbol} is on the curve and registered with the Ring</h2>
        <dl className="kv">
          <dt>Coin address</dt>
          <dd>
            <Address value={launched.mint} />
          </dd>
          {launched.firstBuyTokens !== "0" && (
            <>
              <dt>First buy</dt>
              <dd>
                {formatAmount(launched.firstBuyTokens, COIN_DECIMALS, 2)} {launched.symbol}, {launched.toRing ? "in your Ring balance" : "in your wallet"}
              </dd>
            </>
          )}
        </dl>
        <div className="actions">
          <Link className="btn" href={`/coin/${launched.mint}`}>
            Open the coin
          </Link>
          <Link className="link" href={`/tx/${launched.signature}`}>
            Receipt
          </Link>
          <button
            className="link"
            type="button"
            onClick={() => {
              setLaunched(null);
              setForm(EMPTY);
              clear();
            }}
          >
            Launch another
          </button>
        </div>
      </>
    );
  }
  if (reviewing) {
    return (
      <Confirm
        actions={["launch", ...(buying ? ["curve-trade"] : []), ...(buying && form.toRing ? ["deposit"] : [])]}
        label="Sign and launch"
        busy={busy}
        onConfirm={() => void launch()}
        onCancel={() => setReviewing(false)}
      >
        <p className="body">
          Launch {form.name.trim()} ({form.symbol.trim().toUpperCase()}){buying ? ` with a first buy of ${form.firstBuy.trim()} SOL` : ""}.
        </p>
        {line}
      </Confirm>
    );
  }
  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        review();
      }}
    >
      <div className="pair">
        <div className="field">
          <label className="label" htmlFor="l-name">
            Coin name
          </label>
          <input id="l-name" maxLength={32} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </div>
        <div className="field">
          <label className="label" htmlFor="l-symbol">
            Ticker
          </label>
          <input
            id="l-symbol"
            maxLength={10}
            autoCapitalize="characters"
            value={form.symbol}
            onChange={(event) => setForm({ ...form, symbol: event.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="l-buy">
          Your first buy, in SOL, optional
        </label>
        <input
          id="l-buy"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.0"
          value={form.firstBuy}
          onChange={(event) => setForm({ ...form, firstBuy: event.target.value })}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={form.toRing} onChange={(event) => setForm({ ...form, toRing: event.target.checked })} />
        <span>Put my first buy straight into my Ring balance. The buy itself is public either way.</span>
      </label>
      <div className="actions">
        <button className="btn" type="submit">
          Review
        </button>
      </div>
      {problem && (
        <p className="status-line bad" role="alert">
          {problem}
        </p>
      )}
      {line}
    </form>
  );
}
