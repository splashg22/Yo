"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { COIN_DECIMALS, SOL_DECIMALS, formatAmount } from "@/lib/units";
import { PrivacyPanel } from "./PrivacyPanel";

export interface CoinView {
  mint: string; name: string; symbol: string; creator: string; createdAt: number;
  marketCapLamports: string; priceLamports: number; changePercent: number; changeSince: number; complete: boolean;
  privacy: { supply: string; inRing: string; shareInRingPercent: number; walletsThatDeposited: number };
}
export const NATIVE = "So11111111111111111111111111111111111111112";
export const decimalsOf = (mint: string) => (mint === NATIVE ? SOL_DECIMALS : COIN_DECIMALS);
export const sol = (lamports: string | bigint, places = 4) => `${formatAmount(lamports, SOL_DECIMALS, places)} SOL`;

/** The coins launched here, refreshed now and then. */
export function useCoins(everyMs = 8000) {
  const [coins, setCoins] = useState<CoinView[] | null>(null);
  const refresh = useCallback(() => api<{ coins: CoinView[] }>("explore").then((r) => setCoins(r.coins)).catch(() => setCoins((c) => c ?? [])), []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, everyMs);
    return () => clearInterval(timer);
  }, [refresh, everyMs]);
  const symbol = (mint: string) => (mint === NATIVE ? "SOL" : coins?.find((c) => c.mint === mint)?.symbol ?? `${mint.slice(0, 4)}…`);
  return { coins, refresh, symbol };
}

/** An address in its real case, with a copy control. */
export function Address({ value, short }: { value: string; short?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="addr">
      <span className="address" title={value}>{short ? `${value.slice(0, 4)}…${value.slice(-4)}` : value}</span>
      <button className="link" onClick={() => navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }, () => undefined)}>
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

/** Runs one action at a time and reports how it went, in words. */
export function useRun() {
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (working: string, task: () => Promise<string>) => {
    setBusy(true); setStatus({ text: working });
    try { setStatus({ text: await task() }); return true; }
    catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), bad: true }); return false; }
    finally { setBusy(false); }
  }, []);
  const line = <p className={`status-line ${status?.bad ? "bad" : ""}`} role="status">{status?.text}</p>;
  return { run, busy, line, clear: () => setStatus(null) };
}

/**
 * The step before every signature: what this action will make public and what it will
 * encrypt, then the button that signs.
 */
export function Confirm({ actions, label, onConfirm, onCancel, busy, children }: {
  actions: string[]; label: string; onConfirm(): void; onCancel(): void; busy?: boolean; children?: ReactNode;
}) {
  return (
    <div className="confirm">
      {children}
      {actions.map((action) => <PrivacyPanel key={action} action={action} />)}
      <div className="actions">
        <button className="btn" onClick={onConfirm} disabled={busy}>{label}</button>
        <button className="link" onClick={onCancel} disabled={busy}>Back</button>
      </div>
    </div>
  );
}

/** The privacy score: two public facts, each named for exactly what it measures. */
export function RingBadge({ privacy }: { privacy: CoinView["privacy"] }) {
  return (
    <span className="badge">
      <b>{privacy.shareInRingPercent.toFixed(2)}%</b> of supply in Ring balances
      <span className="sep" />
      <b>{privacy.walletsThatDeposited}</b> {privacy.walletsThatDeposited === 1 ? "wallet has" : "wallets have"} deposited it
    </span>
  );
}
