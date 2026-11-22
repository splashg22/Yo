"use client";

import { Choice } from "../ui/controls";
import QRCode from "qrcode";
import { sealNoteFor } from "@/lib/client/notes";
import { useEffect, useMemo, useState } from "react";
import { ringBackend } from "@/lib/client/ring";
import { NATIVE, decimalsOf } from "@/lib/constants";
import { formatCoin, parseAmount } from "@/lib/format";
import { parsePayLink, payLink, type PayRequest } from "@/lib/paylink";
import { Address } from "../ui/Address";
import { Confirm } from "../ui/Confirm";
import { useCoins } from "../ui/useCoins";
import { useRun } from "../ui/useRun";
import { WalletGate } from "../wallet/WalletGate";
import { useWallet } from "../wallet/WalletProvider";
import { NeedsRing } from "../ui/NeedsRing";
import { AppPage } from "./shell";

/** A QR code drawn as plain squares, dark on white so any camera reads it. */
function QrCode({ text }: { text: string }) {
  const path = useMemo(() => {
    const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
    const squares: string[] = [];
    for (let y = 0; y < modules.size; y++) for (let x = 0; x < modules.size; x++) if (modules.data[y * modules.size + x]) squares.push(`M${x} ${y}h1v1h-1z`);
    return { size: modules.size, d: squares.join("") };
  }, [text]);
  return (
    <div className="qr">
      <svg viewBox={`0 0 ${path.size} ${path.size}`} shapeRendering="crispEdges" role="img" aria-label="QR code of the pay link">
        <path d={path.d} fill="#000" />
      </svg>
    </div>
  );
}

const INTRO =
  "A pay link names a recipient, a coin and an amount, and opens a Ring transfer with them filled in. Anyone who holds the link can read what it asks for. The request travels in the part of the link that browsers do not send to servers. The payment is a transfer between the two wallets: they are public, the coin and the amount are not published. In this build Ring balances are simulated.";

export function PayPage() {
  // The link is read in the browser: until then nothing is known, which is its own state.
  const [request, setRequest] = useState<PayRequest | "none" | "invalid" | null>(null);
  useEffect(() => {
    const read = () => {
      if (!window.location.hash && !window.location.search) return setRequest("none");
      try {
        setRequest(parsePayLink(window.location.href));
      } catch {
        setRequest("invalid");
      }
    };
    read();
    // The request lives after the #, so opening another pay link in the same tab changes only that part and loads nothing.
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const asked = request !== null && request !== "none" && request !== "invalid";
  return (
    <AppPage label="Pay links" title={asked ? "You have been asked to pay" : "Ask for a payment into your Ring balance"} intro={INTRO}>
      {request === null && <p className="body">Reading the link.</p>}
      {request === "invalid" && (
        <p className="notice" role="alert">
          This pay link is not valid. Ask the sender for a new one.
        </p>
      )}
      {request === "none" && (
        <NeedsRing>
          <WalletGate>
            <MakeLink />
          </WalletGate>
        </NeedsRing>
      )}
      {asked && (
        <NeedsRing>
          <WalletGate>
            {/* Keyed by the request, so a second link starts clean instead of showing the first one as paid. */}
            <PayRequestView key={JSON.stringify(request)} request={request} />
          </WalletGate>
        </NeedsRing>
      )}
    </AppPage>
  );
}

function PayRequestView({ request }: { request: PayRequest }) {
  const { signer, config } = useWallet();
  const { symbol } = useCoins();
  const { run, busy, line } = useRun();
  const [paid, setPaid] = useState(false);
  const me = signer!;
  const backend = ringBackend(config)!;
  const pay = () =>
    run("Sending", async (onSent) => {
      // A payment is a Ring transfer, through whichever Ring this deployment runs on.
      const note = backend.notes ? await sealNoteFor(me, request.to, request.memo ?? "") : undefined;
      const sent = await backend.transfer(me, request.to, request.mint, BigInt(request.amount), note, { sent: onSent });
      setPaid(true);
      return {
        message: `Paid ${formatCoin(request.mint, request.amount)} ${symbol(request.mint)} from your Ring balance.`,
        ...(sent.signature ? { signature: sent.signature } : {}),
      };
    });
  if (paid) return <>{line}</>;
  if (request.to === me.address) return <p className="notice">This link asks for a payment to your own wallet. Send it to the person who is paying you.</p>;
  return (
    <Confirm actions={["pay-link"]} label="Sign and pay" busy={busy} onConfirm={() => void pay()} onCancel={() => window.history.back()}>
      <dl className="kv">
        <dt>Pay</dt>
        <dd className="num">
          {formatCoin(request.mint, request.amount)} {symbol(request.mint)}
        </dd>
        <dt>To</dt>
        <dd>
          <Address value={request.to} />
        </dd>
        {request.memo && (
          <>
            <dt>Note</dt>
            <dd className="wrap-anywhere">{request.memo}</dd>
          </>
        )}
      </dl>
      {line}
    </Confirm>
  );
}

function MakeLink() {
  const { signer } = useWallet();
  const { coins, symbol } = useCoins();
  const [form, setForm] = useState({ mint: NATIVE, amount: "", memo: "" });
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const mints = [NATIVE, ...(coins ?? []).map((coin) => coin.mint)];
  let link = "";
  let problem = "";
  if (form.amount.trim()) {
    try {
      link = payLink(window.location.origin, {
        to: signer!.address,
        mint: form.mint,
        amount: parseAmount(form.amount, decimalsOf(form.mint)).toString(),
        memo: form.memo,
      });
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }
  const copy = () => {
    navigator.clipboard.writeText(link).then(
      () => setCopyState("copied"),
      () => setCopyState("failed"),
    );
    setTimeout(() => setCopyState("idle"), 1500);
  };
  return (
    <div className="form">
      <div className="pair">
        <div className="field">
          <label className="label" htmlFor="p-coin">
            Coin
          </label>
          <Choice
            id="p-coin"
            label="Coin"
            value={form.mint}
            onChange={(mint) => setForm({ ...form, mint })}
            options={mints.map((mint) => ({ value: mint, label: symbol(mint) }))}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="p-amount">
            Amount
          </label>
          <input
            id="p-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.0"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="p-memo">
          Note, optional
        </label>
        <input id="p-memo" maxLength={140} value={form.memo} onChange={(event) => setForm({ ...form, memo: event.target.value })} />
      </div>
      {problem && (
        <p className="status-line bad" role="alert">
          {problem}
        </p>
      )}
      {!link && !problem && <p className="body">Enter an amount and the link appears here.</p>}
      {link && (
        <>
          <QrCode text={link} />
          <p className="address" id="pay-link">
            {link}
          </p>
          <div className="actions">
            <button className="link" type="button" onClick={copy}>
              {copyState === "copied" ? "Copied" : copyState === "failed" ? "Select it to copy" : "Copy link"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
