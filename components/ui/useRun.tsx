"use client";

import Link from "next/link";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { useTx } from "../tx/Tx";

export interface Outcome {
  message: string;
  /** If the action landed a transaction, its signature: the status line links to its receipt. */
  signature?: string;
}
type Status = { kind: "working" | "done" | "problem"; text: string; signature?: string };

/** Called by an action the moment the network has its transaction, with the signature, so the tray can say "sent" and link the receipt. */
export type Sent = (signature: string) => void;

/**
 * Runs one action at a time and says how it went, in a line beside the action and in the site's tray, where
 * it passes through signing, sent and confirmed or failed. A second click while the first is in flight does
 * nothing: the lock is a ref, so it holds before React has re-rendered.
 */
export function useRun(): {
  run: (working: string, task: (sent: Sent) => Promise<Outcome>) => Promise<boolean>;
  busy: boolean;
  line: ReactNode;
  clear: () => void;
} {
  const tx = useTx();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);

  const run = useCallback(
    async (working: string, task: (sent: Sent) => Promise<Outcome>) => {
      if (locked.current) return false;
      locked.current = true;
      setBusy(true);
      setStatus({ kind: "working", text: working });
      const handle = tx.begin(working);
      try {
        const outcome = await task(handle.sent);
        setStatus({ kind: "done", text: outcome.message, signature: outcome.signature });
        handle.confirmed(outcome.message, outcome.signature);
        return true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        setStatus({ kind: "problem", text: reason });
        handle.failed(reason, /expired/i.test(reason));
        return false;
      } finally {
        locked.current = false;
        setBusy(false);
      }
    },
    [tx],
  );

  const line = (
    <p className={`status-line ${status?.kind === "problem" ? "bad" : ""}`} role="status" aria-live="polite">
      {status?.text}
      {status?.signature && (
        <>
          {" "}
          <Link className="link" href={`/tx/${status.signature}`}>
            Receipt
          </Link>
        </>
      )}
    </p>
  );
  return { run, busy, line, clear: () => setStatus(null) };
}
