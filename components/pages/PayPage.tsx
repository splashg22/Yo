"use client";

import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { signedApi } from "@/lib/client/api";
import { NATIVE, decimalsOf } from "@/lib/constants";
import { formatCoin, parseAmount } from "@/lib/format";
import { parsePayLink, payLink, type PayRequest } from "@/lib/paylink";
import { Address } from "../ui/Address";
import { Confirm } from "../ui/Confirm";
import { useCoins } from "../ui/useCoins";
import { useRun } from "../ui/useRun";
import { WalletGate } from "../wallet/WalletGate";
import { useWallet } from "../wallet/WalletProvider";
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
  "A pay link names a recipient, a coin and an amount, and opens a Ring transfer with them filled in. Anyone who holds the link can read what it asks for. On-chain, the payment shows the two wallets and encrypts the coin and the amount.";

export function PayPage() {
  // The link is read in the browser: until then nothing is known, which is its own state.
  const [request, setRequest] = useState<PayRequest | "none" | "invalid" | null>(null);
  useEffect(() => {
    if (!window.location.search) return setRequest("none");
    try {
      setRequest(parsePayLink(window.location.href));
    } catch {
      setRequest("invalid");
    }
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
        <WalletGate>
          <MakeLink />
        </WalletGate>
      )}
      {asked && (
        <WalletGate>
          <PayRequestView request={request} />
        </WalletGate>
      )}
    </AppPage>
  );
}

function PayRequestView({ request }: { request: PayRequest }) {
  const { signer } = useWallet();
  const { symbol } = useCoins();
  const { run, busy, line } = useRun();
  const [paid, setPaid] = useState(false);
  const me = signer!;
  const pay = () =>
    run("Sending", async () => {
      await signedApi("ring/transfer", me, request);
      setPaid(true);
      return { message: `Paid ${formatCoin(request.mint, request.amount)} ${symbol(request.mint)} from your Ring balance.` };
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
            <dt>Memo</dt>
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
          <select id="p-coin" value={form.mint} onChange={(event) => setForm({ ...form, mint: event.target.value })}>
            {mints.map((mint) => (
              <option key={mint} value={mint}>
                {symbol(mint)}
              </option>
            ))}
          </select>
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
          Memo, optional
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
