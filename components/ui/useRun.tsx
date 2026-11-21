"use client";

import Link from "next/link";
import { useCallback, useRef, useState, type ReactNode } from "react";

export interface Outcome {
  message: string;
  /** If the action landed a transaction, its signature: the status line links to its receipt. */
  signature?: string;
}
type Status = { kind: "working" | "done" | "problem"; text: string; signature?: string };

/**
 * Runs one action at a time and says how it went. A second click while the first is in
 * flight does nothing: the lock is a ref, so it holds before React has re-rendered.
 */
export function useRun(): { run: (working: string, task: () => Promise<Outcome>) => Promise<boolean>; busy: boolean; line: ReactNode; clear: () => void } {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);

  const run = useCallback(async (working: string, task: () => Promise<Outcome>) => {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setStatus({ kind: "working", text: working });
    try {
      const outcome = await task();
      setStatus({ kind: "done", text: outcome.message, signature: outcome.signature });
      return true;
    } catch (error) {
      setStatus({ kind: "problem", text: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }, []);

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
