"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { Status } from "@/lib/contract";
import { formatCoin, formatTime } from "@/lib/format";
import { Address } from "../ui/Address";
import { useCoins } from "../ui/useCoins";
import { useWallet } from "../wallet/WalletProvider";
import { AppPage } from "./shell";

const yesNo = (ok: boolean, yes: string, no: string) => <span className={ok ? "state-ok" : "state-bad"}>{ok ? yes : no}</span>;

export function StatusPage() {
  const { symbol } = useCoins(30_000);
  const { config } = useWallet();
  const ring = config !== null && config !== "offline" ? config.ring : "mock";
  const [status, setStatus] = useState<Status | null>(null);
  const [problem, setProblem] = useState("");
  const refresh = useCallback(async () => {
    try {
      setStatus(await api("status"));
      setProblem("");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 10_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <AppPage label="Status" title="What this build is running on, read just now" intro="Read from the chain when this page asks.">
      {problem && (
        <p className="notice" role="alert">
          The status could not be read: {problem}{" "}
          <button className="link" type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </p>
      )}
      {status === null && !problem && <p className="body">Reading the chain.</p>}
      {status && (
        <>
          <dl className="kv">
            <dt>Checked</dt>
            <dd>{formatTime(status.checkedAt)}</dd>
            <dt>Network</dt>
            <dd>
              {status.network === "local"
                ? "A local test chain on this machine"
                : status.network === "mainnet"
                  ? "Solana mainnet, read only. This build builds and sends no transaction there"
                  : "Solana devnet"}
            </dd>
            <dt>Chain</dt>
            <dd>
              {yesNo(
                status.chain.reachable,
                `Answering, at slot ${status.chain.slot?.toLocaleString("en-US") ?? "unknown"}, version ${status.chain.version ?? "unknown"}`,
                `Not answering: ${status.chain.problem ?? "no reason given"}`,
              )}
            </dd>
            <dt>Ring balances</dt>
            <dd>
              {ring === "real" ? (
                <span className="state-ok">
                  Held by the real Privacy Rings program on devnet, reached through its SDK in your browser. It is alpha software, and this build has not yet
                  run a deposit, transfer or withdrawal through it.
                </span>
              ) : ring === "unavailable" ? (
                <span className="state-bad">Not connected on this network in this build.</span>
              ) : (
                <span className="state-bad">Simulated by a local stand-in. The Privacy Rings program does not hold them in this build.</span>
              )}
            </dd>
            {status.escrowAddress && (
              <>
                <dt>Stand-in escrow wallet</dt>
                <dd>
                  <Address value={status.escrowAddress} />
                </dd>
              </>
            )}
            <dt>Launch lookup table</dt>
            <dd>{yesNo(status.launchTable, "Present", "Not created yet. It is made before the first launch.")}</dd>
            <dt>Coins launched here</dt>
            <dd className="num">{status.coins}</dd>
            <dt>Payouts awaiting confirmation</dt>
            <dd className="num">{status.pendingPayouts}</dd>
          </dl>
          {status.chain.reachable && (
            <>
              <h2 className="h3">Programs on this chain</h2>
              <ul className="events">
                {status.programs.map((program) => (
                  <li key={program.address}>
                    <b>{program.name}</b>
                    <Address value={program.address} />
                    <span>{yesNo(program.present, "Deployed", "Missing")}</span>
                  </li>
                ))}
              </ul>
              <h2 className="h3">What the stand-in holds against what it owes</h2>
              <p className="body">
                For each coin, the escrow wallet&apos;s balance on-chain and the total of every Ring balance in the ledger. The first must never be below the
                second.
              </p>
              {status.escrow.length === 0 ? (
                <p className="body">Nothing is held in Ring balances yet.</p>
              ) : (
                <div className="scroll-x">
                  <table className="plain">
                    <thead>
                      <tr>
                        <th>Coin</th>
                        <th>Held on-chain</th>
                        <th>Owed to Ring balances</th>
                        <th>Covered</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.escrow.map((row) => (
                        <tr key={row.mint}>
                          <td data-label="Coin">{symbol(row.mint)}</td>
                          <td data-label="Held" className="num">
                            {formatCoin(row.mint, row.held)}
                          </td>
                          <td data-label="Owed" className="num">
                            {formatCoin(row.mint, row.owed)}
                          </td>
                          <td data-label="Covered">{yesNo(row.covered, "Yes", "No")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </AppPage>
  );
}
