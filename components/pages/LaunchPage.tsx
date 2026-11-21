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
import { SealedWindows } from "./SealedWindows";
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
        <WhenSwitchedOn />
      </WalletGate>
    </AppPage>
  );
}

/** The sealed launch window appears only when the operator has switched it on. */
function WhenSwitchedOn() {
  const { config } = useWallet();
  return config !== null && config !== "offline" && config.features.sealedWindow ? <SealedWindows /> : null;
}

interface Launched {
  mint: string;
  symbol: string;
  firstBuyTokens: string;
  toRing: boolean;
  signature: string;
}
const EMPTY = { name: "", symbol: "", firstBuy: "", toRing: true, description: "", picture: "", pictureName: "" };
const PICTURE_MAX_BYTES = 1_500_000;

/** Reads a chosen file as base64, for sending. The server checks it again and redraws it. */
function readPicture(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > PICTURE_MAX_BYTES) return reject(new Error("the picture is larger than 1.5 MB"));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("the picture could not be read"));
    // Read as a data address, "data:image/png;base64,....": the part after the comma is the file itself.
    reader.onload = () => resolve(typeof reader.result === "string" ? (reader.result.split(",")[1] ?? "") : "");
    reader.readAsDataURL(file);
  });
}

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
        description: form.description.trim() || undefined,
        picture: form.picture || undefined,
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
          Launch {form.name.trim()} ({form.symbol.trim().toUpperCase()}){buying ? ` with a first buy of ${form.firstBuy.trim()} SOL` : ""}
          {form.pictureName ? `, with the picture ${form.pictureName}` : ", with no picture"}.
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
        <label className="label" htmlFor="l-description">
          Description, optional
        </label>
        <input id="l-description" maxLength={280} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
      </div>
      <div className="field">
        <label className="label" htmlFor="l-picture">
          Picture, optional. PNG, JPEG, WebP or GIF, up to 1.5 MB
        </label>
        <input
          id="l-picture"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return setForm({ ...form, picture: "", pictureName: "" });
            readPicture(file).then(
              (picture) => {
                setForm((current) => ({ ...current, picture, pictureName: file.name }));
                setProblem("");
              },
              (error: unknown) => {
                event.target.value = "";
                setForm((current) => ({ ...current, picture: "", pictureName: "" }));
                setProblem(error instanceof Error ? error.message : String(error));
              },
            );
          }}
        />
        <span className="label">
          The picture and description are public. Hidden data in the file, such as where a photo was taken, is removed before it is kept.
        </span>
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
