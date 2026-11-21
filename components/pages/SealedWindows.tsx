"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, sessionApi, signAndSend, signedApi } from "@/lib/client/api";
import { SOL_DECIMALS } from "@/lib/constants";
import type { WindowView } from "@/lib/contract";
import { formatSol, formatTime, parseAmount } from "@/lib/format";
import { newActor } from "@/lib/keys";
import { PrivacyPanel } from "../PrivacyPanel";
import { Address } from "../ui/Address";
import { useRun } from "../ui/useRun";
import { useWallet } from "../wallet/WalletProvider";

type Limits = { capLamports: string; minimumLamports: string; longestHours: number };

/**
 * The sealed launch window. Shown only when the operator has switched the feature on.
 * Buyers commit SOL from their Ring balances before the coin exists; the launch buys with all of it at once.
 */
export function SealedWindows() {
  const { signer } = useWallet();
  const me = signer!;
  const { run, busy, line } = useRun();
  const [windows, setWindows] = useState<WindowView[] | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [mine, setMine] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: "", symbol: "", hours: "24" });

  const refresh = useCallback(async () => {
    try {
      const listed = await api("window/list");
      setWindows(listed.windows);
      setLimits(listed.limits);
      setProblem("");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, []);
  // What this wallet has committed is a signed read, so it is asked for when the page opens and after each action, not on a timer.
  const refreshMine = useCallback(async () => {
    try {
      setMine((await sessionApi("window/mine", me)).commitments);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, [me]);
  useEffect(() => {
    void refresh();
    void refreshMine();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 8000);
    return () => clearInterval(timer);
  }, [refresh, refreshMine]);

  const act = (working: string, task: () => Promise<{ message: string; signature?: string }>) =>
    run(working, async () => {
      const outcome = await task();
      await Promise.all([refresh(), refreshMine()]);
      return outcome;
    });

  return (
    <section className="form" aria-labelledby="sealed-windows">
      <h2 className="h3" id="sealed-windows">
        Sealed launch windows
      </h2>
      <p className="notice">
        Experimental, and switched on by this site&apos;s operator. A window holds what buyers commit until the coin is launched. In this build it is held by
        the stand-in&apos;s escrow wallet on a local test chain.
      </p>
      <p className="body">
        Before a coin exists, buyers commit SOL from their Ring balances. When the window has closed, its creator launches: one transaction creates the coin and
        buys with everything committed, so every committer gets the same price and nobody can buy first. The launch and its total are public. Who committed how
        much is not published. You can take your commitment back at any time before the launch.
      </p>
      <PrivacyPanel action="sealed-window" />
      {problem && (
        <p className="notice" role="alert">
          The windows could not be read: {problem}
        </p>
      )}
      <ul className="events">
        {windows === null && !problem && <li className="pub">Reading the windows.</li>}
        {windows?.length === 0 && <li className="pub">No window has been opened yet.</li>}
        {windows?.map((window) => {
          const closed = Date.now() >= window.closesAt;
          const committed = mine[window.id];
          return (
            <li key={window.id}>
              <b>
                {window.name} <span className="label">{window.symbol}</span>
              </b>
              <span className="label">
                {window.status === "open"
                  ? closed
                    ? "Closed to new commitments. Waiting for its creator to launch"
                    : `Open until ${formatTime(window.closesAt)}`
                  : window.status}
              </span>
              <span className="pub">
                Public: opened by <Address value={window.creator} short />, {window.committers} {window.committers === 1 ? "wallet has" : "wallets have"}{" "}
                committed {formatSol(window.totalLamports, 9)} in total.
              </span>
              {committed && <span className="enc">Not published: you have committed {formatSol(committed, 9)}.</span>}
              {window.status === "launched" && window.mint && (
                <span className="actions">
                  <Link className="link" href={`/coin/${window.mint}`}>
                    Open the coin
                  </Link>
                  {window.signature && (
                    <Link className="link" href={`/tx/${window.signature}`}>
                      Receipt
                    </Link>
                  )}
                </span>
              )}
              {window.status === "open" && (
                <span className="actions">
                  {!closed && (
                    <>
                      <label className="visually-hidden" htmlFor={`sw-${window.id}`}>
                        SOL to commit to {window.name}
                      </label>
                      <input
                        id={`sw-${window.id}`}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="SOL"
                        value={amounts[window.id] ?? ""}
                        onChange={(event) => setAmounts({ ...amounts, [window.id]: event.target.value })}
                      />
                      <button
                        className="link"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void act("Committing", async () => {
                            const lamports = parseAmount(amounts[window.id] ?? "", SOL_DECIMALS).toString();
                            await signedApi("window/commit", me, { id: window.id, lamports });
                            setAmounts((current) => ({ ...current, [window.id]: "" }));
                            return { message: `Committed to ${window.name} from your Ring balance.` };
                          })
                        }
                      >
                        Commit
                      </button>
                    </>
                  )}
                  {committed && (
                    <button
                      className="link"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act("Returning your commitment", async () => {
                          await signedApi("window/uncommit", me, { id: window.id });
                          return { message: "Your commitment is back in your Ring balance." };
                        })
                      }
                    >
                      Take mine back
                    </button>
                  )}
                  {window.creator === me.address && closed && (
                    <button
                      className="link"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act("Waiting for the chain to confirm", async () => {
                          const mint = newActor(); // the new coin's own key: it signs this one transaction and is then discarded
                          const built = await signedApi("window/launch/build", me, { id: window.id, mint: mint.address });
                          const sent = await signAndSend(me, built.transaction, [mint.seed]);
                          return { message: `${window.symbol} is launched, bought with everything committed.`, signature: sent.signature };
                        })
                      }
                    >
                      Launch
                    </button>
                  )}
                  {window.creator === me.address && (
                    <button
                      className="link"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act("Cancelling", async () => {
                          await signedApi("window/cancel", me, { id: window.id });
                          return { message: "Window cancelled. Every commitment was returned." };
                        })
                      }
                    >
                      Cancel the window
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <h3 className="h3">Open a window</h3>
      <div className="pair">
        <div className="field">
          <label className="label" htmlFor="sw-name">
            Coin name
          </label>
          <input id="sw-name" maxLength={32} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </div>
        <div className="field">
          <label className="label" htmlFor="sw-symbol">
            Ticker
          </label>
          <input id="sw-symbol" maxLength={10} value={form.symbol} onChange={(event) => setForm({ ...form, symbol: event.target.value })} />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="sw-hours">
          Hours open to commitments, 1 to {limits?.longestHours ?? 72}
        </label>
        <input id="sw-hours" inputMode="numeric" value={form.hours} onChange={(event) => setForm({ ...form, hours: event.target.value })} />
      </div>
      {limits && (
        <p className="body">
          A window can hold at most {formatSol(limits.capLamports, 9)} and needs at least {formatSol(limits.minimumLamports, 9)} to launch.
        </p>
      )}
      <div className="actions">
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={() =>
            void act("Opening the window", async () => {
              if (!form.name.trim()) throw new Error("give the coin a name");
              await signedApi("window/open", me, { name: form.name.trim(), symbol: form.symbol.trim(), hours: Number(form.hours) });
              setForm({ name: "", symbol: "", hours: "24" });
              return { message: "Window opened." };
            })
          }
        >
          Open window
        </button>
      </div>
      {line}
    </section>
  );
}
