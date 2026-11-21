"use client";

import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { signedApi } from "@/lib/client/api";
import { parsePayLink, payLink, type PayRequest } from "@/lib/paylink";
import { formatAmount, parseAmount } from "@/lib/units";
import { Address, Confirm, NATIVE, decimalsOf, useCoins, useRun } from "../ui";
import { WalletGate, useWallet } from "../Wallet";
import { AppPage } from "./shell";

/** A QR code drawn as plain squares. */
function Qr({ text }: { text: string }) {
  const cells = useMemo(() => { const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" }); return { size: modules.size, data: modules.data }; }, [text]);
  const path: string[] = [];
  for (let y = 0; y < cells.size; y++) for (let x = 0; x < cells.size; x++) if (cells.data[y * cells.size + x]) path.push(`M${x} ${y}h1v1h-1z`);
  return <div className="qr"><svg viewBox={`0 0 ${cells.size} ${cells.size}`} shapeRendering="crispEdges" role="img" aria-label="QR code of the pay link"><path d={path.join("")} fill="#000" /></svg></div>;
}

export function PayPage() {
  const [request, setRequest] = useState<PayRequest | null | "bad">(null);
  useEffect(() => {
    if (!location.search) return;
    try { setRequest(parsePayLink(location.href)); } catch { setRequest("bad"); }
  }, []);
  return (
    <AppPage label="Pay links" title={request && request !== "bad" ? "You have been asked to pay" : "Ask for a payment into your Ring balance"} intro="A pay link names a recipient, a coin and an amount, and opens a Ring transfer with them filled in. Anyone who holds the link can read what it asks for. On-chain, the payment shows the two wallets and encrypts the coin and the amount.">
      {request === "bad" ? <p className="notice">This pay link is not valid. Ask the sender for a new one.</p> : <WalletGate>{request ? <Pay request={request} /> : <Make />}</WalletGate>}
    </AppPage>
  );
}

function Pay({ request }: { request: PayRequest }) {
  const { signer } = useWallet();
  const { symbol } = useCoins();
  const { run, busy, line } = useRun();
  const [paid, setPaid] = useState(false);
  const pay = () => run("Signing…", async () => { await signedApi("ring/transfer", signer!, request); setPaid(true); return "Paid from your Ring balance."; });
  if (paid) return <>{line}</>;
  return (
    <Confirm actions={["pay-link"]} label="Sign and pay" busy={busy} onConfirm={pay} onCancel={() => history.back()}>
      <dl className="kv">
        <dt>Pay</dt><dd className="num">{formatAmount(request.amount, decimalsOf(request.mint))} {symbol(request.mint)}</dd>
        <dt>To</dt><dd><Address value={request.to} /></dd>
        {request.memo && <><dt>Memo</dt><dd>{request.memo}</dd></>}
      </dl>
      {line}
    </Confirm>
  );
}

function Make() {
  const { signer } = useWallet();
  const { coins, symbol } = useCoins();
  const [form, setForm] = useState({ mint: NATIVE, amount: "", memo: "" });
  const [copied, setCopied] = useState(false);
  const mints = [NATIVE, ...(coins ?? []).map((c) => c.mint)];
  let link = "", problem = "";
  if (form.amount) {
    try { link = payLink(location.origin, { to: signer!.address, mint: form.mint, amount: parseAmount(form.amount, decimalsOf(form.mint)).toString(), memo: form.memo }); }
    catch (error) { problem = error instanceof Error ? error.message : String(error); }
  }
  return (
    <div className="form">
      <div className="pair">
        <div className="field"><label className="label" htmlFor="p-coin">Coin</label>
          <select id="p-coin" value={form.mint} onChange={(e) => setForm({ ...form, mint: e.target.value })}>{mints.map((m) => <option key={m} value={m}>{symbol(m)}</option>)}</select></div>
        <div className="field"><label className="label" htmlFor="p-amount">Amount</label><input id="p-amount" inputMode="decimal" placeholder="0.0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
      </div>
      <div className="field"><label className="label" htmlFor="p-memo">Memo, optional</label><input id="p-memo" maxLength={140} value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></div>
      {problem && <p className="status-line bad">{problem}</p>}
      {link && (
        <>
          <Qr text={link} />
          <p className="address" id="pay-link">{link}</p>
          <div className="actions"><button className="link" onClick={() => navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }, () => undefined)}>{copied ? "Copied" : "Copy link"}</button></div>
        </>
      )}
    </div>
  );
}
