"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { NATIVE } from "@/lib/constants";
import type { TransactionView } from "@/lib/contract";
import { formatCoin, formatSol, formatTime } from "@/lib/format";
import { Address } from "../ui/Address";
import { useCoins } from "../ui/useCoins";
import { AppPage } from "./shell";

const PROGRAM_NAMES: Record<string, string> = {
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": "pump.fun",
  ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW: "Privacy Rings",
  "11111111111111111111111111111111": "System (SOL transfer)",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated token account",
  ComputeBudget111111111111111111111111111111: "Compute budget",
};

export function TransactionPage({ signature }: { signature: string }) {
  const { symbol } = useCoins(60_000);
  const [view, setView] = useState<TransactionView | null>(null);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    api("tx/status", { signature }).then(setView, (error: unknown) => setProblem(error instanceof Error ? error.message : String(error)));
  }, [signature]);
  const title =
    view === null ? "Reading the chain" : view.status === "confirmed" ? "Confirmed" : view.status === "failed" ? "Failed on-chain" : "Not found on this chain";
  return (
    <AppPage
      label="Receipt"
      title={problem ? "This receipt could not be read" : title}
      intro="A transaction as the chain recorded it. Everything on this page is public."
    >
      {problem && (
        <p className="notice" role="alert">
          {problem}
        </p>
      )}
      {view && (
        <dl className="kv">
          <dt>Signature</dt>
          <dd>
            <Address value={view.signature} />
          </dd>
          {view.status === "not-found" && (
            <>
              <dt>Why</dt>
              <dd>The chain has no record of it. It may have expired before landing, or belong to another network.</dd>
            </>
          )}
          {view.slot !== undefined && (
            <>
              <dt>Slot</dt>
              <dd className="num">{view.slot.toLocaleString("en-US")}</dd>
            </>
          )}
          {view.blockTime !== undefined && (
            <>
              <dt>Time</dt>
              <dd>{formatTime(view.blockTime * 1000)}</dd>
            </>
          )}
          {view.payer && (
            <>
              <dt>Paid for by</dt>
              <dd>
                <Address value={view.payer} />
              </dd>
            </>
          )}
          {view.feeLamports !== undefined && (
            <>
              <dt>Network fee</dt>
              <dd className="num">{formatSol(view.feeLamports, 9)}</dd>
            </>
          )}
          {view.programs.length > 0 && (
            <>
              <dt>Programs called</dt>
              <dd>{view.programs.map((id) => PROGRAM_NAMES[id] ?? id).join(", ")}</dd>
            </>
          )}
          {view.changes.map((change) => (
            <span key={change.mint} style={{ display: "contents" }}>
              <dt>{change.amount.startsWith("-") ? "Paying wallet spent" : "Paying wallet received"}</dt>
              <dd className="num">
                {formatCoin(change.mint, change.amount.replace("-", ""))} {symbol(change.mint)}
                {change.mint === NATIVE && change.amount.startsWith("-") ? ", network fee included" : ""}
              </dd>
            </span>
          ))}
          {view.deposits.map((deposit, index) => (
            <span key={index} style={{ display: "contents" }}>
              <dt>Paid into the Ring</dt>
              <dd className="num">
                {formatCoin(deposit.coin!, deposit.amount!)} {symbol(deposit.coin!)}
              </dd>
            </span>
          ))}
        </dl>
      )}
      <div className="actions">
        <Link className="link" href="/wallet">
          Ring wallet
        </Link>
        <Link className="link" href="/explore">
          Explore
        </Link>
      </div>
    </AppPage>
  );
}
