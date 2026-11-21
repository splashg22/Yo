"use client";

import { useCallback, useEffect, useState } from "react";
import { api, signAndSend, signedApi } from "@/lib/client/api";
import { sealNoteFor } from "@/lib/client/notes";
import { NATIVE, decimalsOf } from "@/lib/constants";
import type { Api } from "@/lib/contract";
import { formatCoin, parseAmount } from "@/lib/format";
import { withdrawalWarnings } from "@/lib/linkability";
import { ActivityList } from "../ui/ActivityList";
import { Address } from "../ui/Address";
import { Confirm } from "../ui/Confirm";
import { RingEventRow } from "../ui/RingEventRow";
import { NeedsRing } from "../ui/NeedsRing";
import { useCoins } from "../ui/useCoins";
import { useHashChoice } from "../ui/useHashChoice";
import { useRun, type Outcome } from "../ui/useRun";
import { WalletGate } from "../wallet/WalletGate";
import { useWallet } from "../wallet/WalletProvider";
import { AppPage } from "./shell";

const TABS = ["deposit", "transfer", "withdraw"] as const;
type Mine = Api["ring/mine"]["output"];

export function WalletPage() {
  return (
    <AppPage
      label="Ring wallet"
      title="Deposit, transfer, withdraw"
      intro="Moving coins into or out of a Ring balance is public. Moving them between Ring balances encrypts the coin and the amount; both wallet addresses stay public."
    >
      <WalletGate>
        <NeedsRing instead={<PublicWallet />}>
          <OpenWallet />
        </NeedsRing>
      </WalletGate>
    </AppPage>
  );
}

/** The wallet where there is no Ring to hold anything in: its address, what it holds in public, and its transactions. */
function PublicWallet() {
  const { signer, lock } = useWallet();
  const { coins, symbol } = useCoins();
  const me = signer!;
  const [inWallet, setInWallet] = useState<Record<string, string> | null>(null);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    api("wallet/public", { wallet: me.address }).then(
      (answer) => setInWallet(answer.balances),
      (error: unknown) => setProblem(error instanceof Error ? error.message : String(error)),
    );
  }, [me.address, coins?.length]);
  const loadActivity = useCallback(() => api("wallet/activity", { wallet: me.address }), [me.address]);
  return (
    <>
      <dl className="kv">
        <dt>{me.kind === "browser" ? "Wallet address" : me.label}</dt>
        <dd>
          <Address value={me.address} />
        </dd>
        {Object.entries(inWallet ?? {}).map(([mint, amount]) => (
          <span key={mint} style={{ display: "contents" }}>
            <dt>{symbol(mint)}, public</dt>
            <dd className="num">{formatCoin(mint, amount)}</dd>
          </span>
        ))}
      </dl>
      {problem && (
        <p className="notice" role="alert">
          Your balances could not be read: {problem}
        </p>
      )}
      <div className="actions">
        <button className="link" type="button" onClick={lock}>
          Lock
        </button>
      </div>
      <h2 className="h3">Your wallet&apos;s public transactions</h2>
      <ActivityList load={loadActivity} empty="None yet. Funding the wallet will be the first." />
    </>
  );
}

function OpenWallet() {
  const { signer, config, lock, backupFile } = useWallet();
  const { coins, symbol } = useCoins();
  const { run, busy, line } = useRun();
  const [mine, setMine] = useState<Mine | null>(null);
  const [inWallet, setInWallet] = useState<Record<string, string> | null>(null);
  const [loadProblem, setLoadProblem] = useState("");
  const [tab, setTab] = useHashChoice(TABS);
  const [form, setForm] = useState({ mint: NATIVE, amount: "", to: "", memo: "" });
  const [reviewing, setReviewing] = useState(false);
  const [formProblem, setFormProblem] = useState("");
  const me = signer!;

  const refresh = useCallback(async () => {
    try {
      const [ringSide, walletSide] = await Promise.all([signedApi("ring/mine", me), api("wallet/public", { wallet: me.address })]);
      setMine(ringSide);
      setInWallet(walletSide.balances);
      setLoadProblem("");
    } catch (error) {
      setLoadProblem(error instanceof Error ? error.message : String(error));
    }
  }, [me]);
  useEffect(() => {
    void refresh();
  }, [refresh, coins?.length]);
  // Coming back to this tab after acting in another one must not show stale balances. Only for the wallet
  // made in the browser: reading a Ring balance is a signed request, and an extension would ask to approve each one.
  useEffect(() => {
    if (me.kind !== "browser") return;
    const onReturn = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [me.kind, refresh]);

  const mints = [...new Set([NATIVE, ...(coins ?? []).map((coin) => coin.mint), ...Object.keys(mine?.balances ?? {})])];

  const review = () => {
    try {
      parseAmount(form.amount, decimalsOf(form.mint));
      if (tab === "transfer" && !form.to.trim()) throw new Error("enter the recipient's wallet address");
      setFormProblem("");
      setReviewing(true);
    } catch (error) {
      setFormProblem(error instanceof Error ? error.message : String(error));
    }
  };

  const loadActivity = useCallback(() => api("wallet/activity", { wallet: me.address }), [me.address]);

  /** The amount on the confirm step, or zero if it no longer parses: the warnings only need it once it has been reviewed. */
  const reviewedAmount = (): bigint => {
    try {
      return parseAmount(form.amount, decimalsOf(form.mint));
    } catch {
      return 0n;
    }
  };

  const submit = () =>
    run("Waiting for the chain to confirm", async (): Promise<Outcome> => {
      const amount = parseAmount(form.amount, decimalsOf(form.mint)).toString();
      let outcome: Outcome;
      if (tab === "deposit") {
        const { transaction } = await api("ring/deposit/build", { wallet: me.address, mint: form.mint, amount });
        const sent = await signAndSend(me, transaction);
        outcome = { message: `Deposited ${form.amount} ${symbol(form.mint)} into your Ring balance.`, signature: sent.signature };
      } else if (tab === "transfer") {
        const note = await sealNoteFor(me, form.to.trim(), form.memo);
        await signedApi("ring/transfer", me, { to: form.to.trim(), mint: form.mint, amount, note });
        outcome = { message: `Sent ${form.amount} ${symbol(form.mint)}.` };
      } else {
        const result = await signedApi("ring/withdraw", me, { mint: form.mint, amount, destination: form.to.trim() || undefined });
        outcome = result.pending
          ? {
              message:
                'The payout was sent but the chain has not confirmed it yet. Your balance stays reduced until it does. Use "Check for anything missing" in a minute.',
              signature: result.signature,
            }
          : { message: `Withdrew ${form.amount} ${symbol(form.mint)}.`, signature: result.signature };
      }
      setReviewing(false);
      setForm((current) => ({ ...current, amount: "", memo: "" }));
      await refresh();
      return outcome;
    });

  const saveBackup = () => {
    const file = backupFile();
    if (!file) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([file], { type: "application/json" }));
    link.download = `ring-wallet-${me.address.slice(0, 6)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <>
      <dl className="kv">
        <dt>{me.kind === "browser" ? "Deposit address" : me.label}</dt>
        <dd>
          <Address value={me.address} />
        </dd>
      </dl>
      <div className="actions">
        {me.kind === "browser" && (
          <button className="link" type="button" onClick={saveBackup}>
            Save encrypted backup
          </button>
        )}
        {config !== null && config !== "offline" && config.network === "local" && (
          <button
            className="link"
            type="button"
            disabled={busy}
            onClick={() =>
              void run("Asking the faucet", async () => {
                await api("faucet", { wallet: me.address });
                await refresh();
                return { message: "10 test SOL added to your wallet." };
              })
            }
          >
            Get test SOL
          </button>
        )}
        <button
          className="link"
          type="button"
          disabled={busy}
          onClick={() =>
            void run("Checking the chain", async () => {
              const found = await api("ring/reconcile");
              await refresh();
              return {
                message:
                  found.credited + found.payoutsResolved === 0
                    ? "Nothing was missing."
                    : `Recovered ${found.credited} deposit(s) and settled ${found.payoutsResolved} payout(s).`,
              };
            })
          }
        >
          Check for anything missing
        </button>
        <button className="link" type="button" onClick={lock}>
          Lock
        </button>
      </div>
      {me.kind === "browser" && (
        <p className="body">
          Fund this address from any wallet or exchange. That transfer is public, like any other. The key exists only in this browser and in your backup file.
        </p>
      )}

      {loadProblem && (
        <p className="notice" role="alert">
          Your balances could not be read: {loadProblem}{" "}
          <button className="link" type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </p>
      )}
      <div className="scroll-x">
        <table className="plain">
          <thead>
            <tr>
              <th>Coin</th>
              <th>In your wallet, public</th>
              <th>In your Ring balance</th>
            </tr>
          </thead>
          <tbody>
            {mints.map((mint) => (
              <tr key={mint}>
                <td data-label="Coin">{symbol(mint)}</td>
                <td data-label="Wallet" className="num">
                  {inWallet ? formatCoin(mint, inWallet[mint] ?? "0") : "Reading"}
                </td>
                <td data-label="Ring" className="num">
                  {mine ? formatCoin(mint, mine.balances[mint] ?? "0") : "Reading"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="tabs" role="group" aria-label="Action">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={tab === name}
            onClick={() => {
              setTab(name);
              setReviewing(false);
              setFormProblem("");
            }}
          >
            {name}
          </button>
        ))}
      </div>
      {reviewing ? (
        <Confirm actions={[tab]} label={`Sign and ${tab}`} busy={busy} onConfirm={() => void submit()} onCancel={() => setReviewing(false)}>
          <p className="body">
            {tab === "deposit" ? "Deposit" : tab === "transfer" ? "Send" : "Withdraw"} {form.amount} {symbol(form.mint)}
            {tab !== "deposit" && form.to.trim() ? (
              <>
                {" "}
                to <span className="address">{form.to.trim()}</span>
              </>
            ) : null}
            .
          </p>
          {tab === "withdraw" &&
            withdrawalWarnings(mine?.history ?? [], { wallet: me.address, mint: form.mint, amount: reviewedAmount(), destination: form.to.trim() }).map(
              (warning) => (
                <p key={warning} className="notice">
                  {warning}
                </p>
              ),
            )}
        </Confirm>
      ) : (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            review();
          }}
        >
          <div className="pair">
            <div className="field">
              <label className="label" htmlFor="w-coin">
                Coin
              </label>
              <select id="w-coin" value={form.mint} onChange={(event) => setForm({ ...form, mint: event.target.value })}>
                {mints.map((mint) => (
                  <option key={mint} value={mint}>
                    {symbol(mint)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="w-amount">
                Amount
              </label>
              <input
                id="w-amount"
                inputMode="decimal"
                autoComplete="off"
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
                placeholder="0.0"
              />
            </div>
          </div>
          {tab !== "deposit" && (
            <div className="field">
              <label className="label" htmlFor="w-to">
                {tab === "transfer" ? "Recipient's wallet address" : "Destination, if not your own wallet"}
              </label>
              <input
                id="w-to"
                value={form.to}
                onChange={(event) => setForm({ ...form, to: event.target.value })}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
              />
            </div>
          )}
          {tab === "transfer" && (
            <div className="field">
              <label className="label" htmlFor="w-memo">
                Note, sealed in your browser, optional
              </label>
              <input id="w-memo" value={form.memo} maxLength={140} onChange={(event) => setForm({ ...form, memo: event.target.value })} />
            </div>
          )}
          <div className="actions">
            <button className="btn" type="submit">
              Review
            </button>
          </div>
          {formProblem && (
            <p className="status-line bad" role="alert">
              {formProblem}
            </p>
          )}
        </form>
      )}
      {line}

      <h2 className="h3">Your Ring history</h2>
      <ul className="events">
        {mine === null && !loadProblem && <li className="pub">Reading your history.</li>}
        {mine?.history.length === 0 && <li className="pub">Nothing yet. A deposit, transfer or withdrawal will appear here.</li>}
        {mine?.history.map((event) => (
          <RingEventRow key={event.id} event={event} me={me.address} symbol={symbol} noteKeys={me.noteKeys} />
        ))}
      </ul>

      <h2 className="h3">Your wallet&apos;s public transactions</h2>
      <p className="body">The latest transactions this wallet took part in, as anyone can list them from the chain.</p>
      <ActivityList load={loadActivity} version={mine?.history.length ?? 0} empty="None yet. Funding the wallet will be the first." />
    </>
  );
}
