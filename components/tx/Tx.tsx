"use client";

/**
 * Transaction feedback, the same everywhere: every action that reaches the chain shows up in one tray, bottom
 * right, and moves through the same states in front of the person.
 *
 *   signing    the wallet is being asked
 *   sent       the network has it; the signature is known and the receipt is linked
 *   confirmed  the chain took it; how long that took
 *   failed     the chain refused it, or it never got there; why, in one sentence
 *   expired    it was not taken before its time ran out; nothing was spent
 *
 * A confirmed entry leaves by itself after a few seconds. A failed one stays until it is dismissed.
 */
import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type TxState = "signing" | "sent" | "confirmed" | "failed" | "expired";
export interface TxEntry {
  id: number;
  label: string;
  state: TxState;
  signature?: string;
  /** What happened, once it is over: what was bought, or why it failed. */
  detail?: string;
  startedAt: number;
  landedInMs?: number;
}
export interface TxHandle {
  /** The network has the transaction. */
  sent: (signature: string) => void;
  confirmed: (detail?: string, signature?: string) => void;
  failed: (reason: string, expired?: boolean) => void;
}
interface TxApi {
  /** Starts an entry in the tray and returns the handle that moves it on. */
  begin: (label: string) => TxHandle;
  dismiss: (id: number) => void;
}
const Context = createContext<TxApi | null>(null);
const STATE_TEXT: Record<TxState, string> = { signing: "Signing", sent: "Sent", confirmed: "Confirmed", failed: "Failed", expired: "Expired" };
const LEAVES_AFTER_MS = 7_000;
const MOST_SHOWN = 4;

export function TxProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<TxEntry[]>([]);
  const next = useRef(0);
  const dismiss = useCallback((id: number) => setEntries((current) => current.filter((entry) => entry.id !== id)), []);
  const begin = useCallback(
    (label: string): TxHandle => {
      const id = ++next.current;
      const startedAt = Date.now();
      setEntries((current) => [...current.slice(-(MOST_SHOWN - 1)), { id, label, state: "signing", startedAt }]);
      const change = (patch: Partial<TxEntry>) => setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
      return {
        sent: (signature) => change({ state: "sent", signature }),
        confirmed: (detail, signature) => {
          change({ state: "confirmed", detail, landedInMs: Date.now() - startedAt, ...(signature ? { signature } : {}) });
          setTimeout(() => dismiss(id), LEAVES_AFTER_MS);
        },
        failed: (reason, expired) => change({ state: expired ? "expired" : "failed", detail: reason }),
      };
    },
    [dismiss],
  );
  // What pages hold on to never changes, so an entry moving through its states re-renders the tray and nothing else.
  const value = useMemo(() => ({ begin, dismiss }), [begin, dismiss]);
  return (
    <Context.Provider value={value}>
      {children}
      <Tray entries={entries} dismiss={dismiss} />
    </Context.Provider>
  );
}

export function useTx(): TxApi {
  const value = useContext(Context);
  if (!value) throw new Error("useTx needs <TxProvider>");
  return value;
}

function Tray({ entries, dismiss }: { entries: TxEntry[]; dismiss: (id: number) => void }) {
  return (
    <div className="tray" role="log" aria-live="polite" aria-label="Transactions">
      {entries.map((entry) => (
        <div key={entry.id} className={entry.state} data-state={entry.state}>
          <div className="row">
            <span className="state">
              {STATE_TEXT[entry.state]}
              {entry.state === "confirmed" && entry.landedInMs !== undefined && <span className="quiet"> in {(entry.landedInMs / 1000).toFixed(1)}s</span>}
            </span>
            <span>
              {entry.signature && (
                <Link className="link" href={`/tx/${entry.signature}`}>
                  Receipt
                </Link>
              )}
              <button type="button" aria-label="Dismiss" onClick={() => dismiss(entry.id)}>
                Close
              </button>
            </span>
          </div>
          <span>{entry.detail ?? entry.label}</span>
          {(entry.state === "signing" || entry.state === "sent") && (
            <div className="bar" aria-hidden="true">
              <i />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
