"use client";

import { useCallback, useEffect, useState } from "react";
import { api, signAndSend, signedApi } from "@/lib/client/api";
import { formatAmount, parseAmount } from "@/lib/units";
import { Address, Confirm, NATIVE, decimalsOf, useCoins, useRun } from "../ui";
import { WalletGate, useWallet } from "../Wallet";
import { AppPage } from "./shell";

type Tab = "deposit" | "transfer" | "withdraw";
interface Mine { balances: Record<string, string>; history: { id: string; at: number; kind: string; public: Record<string, string>; sealed: Record<string, string> }[] }

export function WalletPage() {
  return (
    <AppPage label="Ring wallet" title="Deposit, transfer, withdraw" intro="Your Ring balance is encrypted on-chain. Moving coins in and out of it is public. Moving them between Ring balances encrypts the coin and the amount.">
      <WalletGate><Inner /></WalletGate>
    </AppPage>
  );
}

function Inner() {
  const { signer, config, lock, backupFile } = useWallet();
  const { coins, symbol } = useCoins();
  const { run, busy, line } = useRun();
  const [mine, setMine] = useState<Mine | null>(null);
  const [wallet, setWallet] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>("deposit");
  const [form, setForm] = useState({ mint: NATIVE, amount: "", to: "", memo: "" });
  const [confirming, setConfirming] = useState(false);
  const me = signer!;

  const refresh = useCallback(async () => {
    const [a, b] = await Promise.all([signedApi<Mine>("ring/mine", me), api<{ balances: Record<string, string> }>("wallet/public", { wallet: me.address })]);
    setMine(a); setWallet(b.balances);
  }, [me]);
  useEffect(() => { void refresh().catch(() => undefined); }, [refresh, coins?.length]);

  const mints = [...new Set([NATIVE, ...(coins ?? []).map((c) => c.mint), ...Object.keys(mine?.balances ?? {})])];
  const show = (mint: string, value: string | undefined) => formatAmount(value ?? "0", decimalsOf(mint));

  const submit = () => run("Signing…", async () => {
    const amount = parseAmount(form.amount, decimalsOf(form.mint)).toString();
    if (tab === "deposit") {
      const { transaction } = await api("ring/deposit/build", { wallet: me.address, mint: form.mint, amount });
      await api("ring/credit", { signature: await signAndSend(me, transaction) });
    } else if (tab === "transfer") {
      await signedApi("ring/transfer", me, { to: form.to.trim(), mint: form.mint, amount, memo: form.memo.trim() || undefined });
    } else {
      await signedApi("ring/withdraw", me, { mint: form.mint, amount, destination: form.to.trim() || undefined });
    }
    setConfirming(false); setForm((f) => ({ ...f, amount: "", memo: "" }));
    await refresh();
    return { deposit: "Deposited.", transfer: "Sent.", withdraw: "Withdrawn." }[tab];
  });

  const saveBackup = () => {
    const file = backupFile();
    if (!file) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([file], { type: "application/json" }));
    link.download = `ring-wallet-${me.address.slice(0, 6)}.json`;
    link.click();
  };

  return (
    <>
      <dl className="kv">
        <dt>{me.kind === "browser" ? "Deposit address" : me.label}</dt>
        <dd><Address value={me.address} /></dd>
      </dl>
      <div className="actions">
        {me.kind === "browser" && <button className="link" onClick={saveBackup}>Save encrypted backup</button>}
        {config?.network === "local" && <button className="link" disabled={busy} onClick={() => run("Asking the faucet…", async () => { await api("faucet", { wallet: me.address }); await refresh(); return "10 test SOL added to your wallet."; })}>Get test SOL</button>}
        <button className="link" onClick={lock}>Lock</button>
      </div>
      {me.kind === "browser" && <p className="body">Fund this address from any wallet or exchange. That transfer is public, like any other. The key exists only in this browser and in your backup file.</p>}

      <div className="scroll-x">
        <table className="plain">
          <thead><tr><th>Coin</th><th>In your wallet, public</th><th>In your Ring balance, encrypted</th></tr></thead>
          <tbody>
            {mints.map((mint) => (
              <tr key={mint}>
                <td data-label="Coin">{symbol(mint)}</td>
                <td data-label="Wallet" className="num">{show(mint, wallet[mint])}</td>
                <td data-label="Ring" className="num">{mine ? show(mint, mine.balances[mint]) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="tabs" role="group" aria-label="Action">
        {(["deposit", "transfer", "withdraw"] as Tab[]).map((t) => <button key={t} aria-pressed={tab === t} onClick={() => { setTab(t); setConfirming(false); }}>{t}</button>)}
      </div>
      {confirming ? (
        <Confirm actions={[tab]} label={`Sign and ${tab}`} busy={busy} onConfirm={submit} onCancel={() => setConfirming(false)}>
          <p className="body">{tab === "deposit" ? "Deposit" : tab === "transfer" ? "Send" : "Withdraw"} {form.amount} {symbol(form.mint)}{tab !== "deposit" && form.to ? <> to <span className="address">{form.to}</span></> : null}.</p>
        </Confirm>
      ) : (
        <div className="form">
          <div className="pair">
            <div className="field"><label className="label" htmlFor="w-coin">Coin</label>
              <select id="w-coin" value={form.mint} onChange={(e) => setForm({ ...form, mint: e.target.value })}>{mints.map((m) => <option key={m} value={m}>{symbol(m)}</option>)}</select></div>
            <div className="field"><label className="label" htmlFor="w-amount">Amount</label>
              <input id="w-amount" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.0" /></div>
          </div>
          {tab !== "deposit" && (
            <div className="field"><label className="label" htmlFor="w-to">{tab === "transfer" ? "Recipient's wallet address" : "Destination, if not your own wallet"}</label>
              <input id="w-to" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} spellCheck={false} autoComplete="off" /></div>
          )}
          {tab === "transfer" && (
            <div className="field"><label className="label" htmlFor="w-memo">Memo, encrypted, optional</label>
              <input id="w-memo" value={form.memo} maxLength={140} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></div>
          )}
          <div className="actions"><button className="btn" disabled={!form.amount || (tab === "transfer" && !form.to)} onClick={() => setConfirming(true)}>Review</button></div>
        </div>
      )}
      {line}

      <h2 className="h3">Your Ring history</h2>
      <ul className="events">
        {mine?.history.length === 0 && <li className="pub">Nothing yet.</li>}
        {mine?.history.map((e) => (
          <li key={e.id}>
            <b>{e.kind}</b>
            <span className="pub">Public: {Object.entries(e.public).map(([k, v]) => `${k} ${k === "coin" ? symbol(v) : k === "amount" ? formatAmount(v, decimalsOf(e.public.coin ?? NATIVE)) : ""}`).filter((s) => !s.endsWith(" ")).join(", ") || ""}
              {Object.entries(e.public).filter(([k]) => !["coin", "amount"].includes(k)).map(([k, v]) => <span key={k}> {k} <span className="address">{v}</span></span>)}</span>
            {Object.keys(e.sealed).length > 0 && (
              <span className="enc">Encrypted, readable by you: {symbol(e.sealed.coin!)} {formatAmount(e.sealed.amount ?? e.sealed.size ?? "0", decimalsOf(e.sealed.coin!))}{e.sealed.price ? ` for ${formatAmount(e.sealed.price, 9)} SOL` : ""}{e.sealed.memo ? `, memo: ${e.sealed.memo}` : ""}</span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
