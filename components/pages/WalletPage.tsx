"use client";

import { useSolPrice } from "../ui/Money";
import { vault } from "@/lib/client/vault";
import { loadPlans, newPlan, savePlans } from "@/lib/client/withdraw-queue";
import { planWithdrawal, type PlannedPart } from "@/lib/withdraw-plan";
import { WithdrawPlans } from "../wallet/WithdrawPlans";
import { ringBackend } from "@/lib/client/ring";
import { Choice } from "../ui/controls";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, signedApi } from "@/lib/client/api";
import { sealNoteFor } from "@/lib/client/notes";
import { NATIVE, decimalsOf } from "@/lib/constants";
import type { Api } from "@/lib/contract";
import { formatCoin, formatUsd, parseAmount, usdOfLamports } from "@/lib/format";
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
  const { config } = useWallet();
  const simulated = config === null || config === "offline" || config.ring !== "real";
  return (
    <AppPage
      label="Ring wallet"
      title="Deposit, transfer, withdraw"
      intro={`Deposits and withdrawals are public. A transfer between Ring balances shows both wallets, not the coin or the amount.${simulated ? " Ring balances are simulated in this build." : ""}`}
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

/** Over how long a split withdrawal can be spread. */
const SPREADS: [number, string][] = [
  [600_000, "10 minutes"],
  [3_600_000, "1 hour"],
  [6 * 3_600_000, "6 hours"],
  [24 * 3_600_000, "24 hours"],
  [72 * 3_600_000, "3 days"],
];
/** A wait in words: "40 seconds", "12 minutes", "5 hours 20 minutes". */
function formatSpan(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))} seconds`;
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const [hours, rest] = [Math.floor(minutes / 60), minutes % 60];
  return `${hours} hour${hours === 1 ? "" : "s"}${rest ? ` ${rest} minute${rest === 1 ? "" : "s"}` : ""}`;
}

/**
 * What the SOL in the table is worth. The table itself keeps exact amounts and nothing else, so it can be checked
 * figure for figure against the chain; the dollar value is an estimate and sits apart from it.
 */
function SolWorth({ wallet, ring }: { wallet: string | undefined; ring: string | undefined }) {
  const price = useSolPrice();
  if (!price || wallet === undefined || ring === undefined) return null;
  return (
    <p className="note-line num" data-worth>
      SOL in your wallet: about {formatUsd(usdOfLamports(wallet, price.usd))}. In your Ring balance: about {formatUsd(usdOfLamports(ring, price.usd))}. At{" "}
      {formatUsd(price.usd)} a SOL.
    </p>
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
  // Which Ring is behind this page is decided by the deployment, not here: the stand-in beside a local chain, the real program on devnet.
  const backend = useMemo(() => ringBackend(config)!, [config]);
  const [stage, setStage] = useState("");
  // A withdrawal can go out in several uneven parts at uneven times: harder to match to what came in.
  const [split, setSplit] = useState({ parts: 1, overMs: 3_600_000 });
  const [planned, setPlanned] = useState<PlannedPart[] | null>(null);
  const [destinationSeen, setDestinationSeen] = useState<boolean | undefined>(undefined);
  const [planVersion, setPlanVersion] = useState(0);
  const [queued, setQueued] = useState("");
  const [fresh, setFresh] = useState<{ open: boolean; password: string; working: boolean; problem: string; made: string }>({
    open: false,
    password: "",
    working: false,
    problem: "",
    made: "",
  });

  const refresh = useCallback(async () => {
    try {
      const [ringSide, walletSide] = await Promise.all([backend.mine(me), api("wallet/public", { wallet: me.address })]);
      setMine(ringSide);
      setInWallet(walletSide.balances);
      setLoadProblem("");
    } catch (error) {
      setLoadProblem(error instanceof Error ? error.message : String(error));
    }
  }, [me, backend]);
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

  const review = async () => {
    try {
      const amount = parseAmount(form.amount, decimalsOf(form.mint));
      if (tab === "transfer" && !form.to.trim()) throw new Error("enter the recipient's wallet address");
      setPlanned(null);
      setDestinationSeen(undefined);
      setQueued("");
      if (tab === "withdraw") {
        // The parts are drawn once, here, so what is reviewed is what is sent.
        if (split.parts > 1) {
          const smallest = amount / BigInt(split.parts * 5) > 0n ? amount / BigInt(split.parts * 5) : 1n;
          setPlanned(planWithdrawal({ total: amount, parts: split.parts, overMs: split.overMs, smallest }));
        }
        const destination = form.to.trim();
        // Whether the destination already has a history is a public fact, and it decides how much the withdrawal gives away.
        if (destination && destination !== me.address)
          setDestinationSeen(
            await api("address/seen", { address: destination }).then(
              (answer) => answer.seen,
              () => undefined,
            ),
          );
      }
      setFormProblem("");
      setReviewing(true);
    } catch (error) {
      setFormProblem(error instanceof Error ? error.message : String(error));
    }
  };

  /** Starts a split withdrawal: the plan is written down in this browser, and the list below sends its parts as they come due. */
  const startSplit = () => {
    if (!planned) return;
    const plan = newPlan({ id: crypto.randomUUID(), mint: form.mint, destination: form.to.trim(), parts: planned, now: Date.now() });
    savePlans(me.address, [...loadPlans(me.address), plan]);
    setPlanVersion((version) => version + 1);
    setQueued(`The withdrawal of ${form.amount} ${symbol(form.mint)} was split into ${planned.length} parts. The first is being sent now.`);
    setReviewing(false);
    setPlanned(null);
    setForm((current) => ({ ...current, amount: "" }));
  };

  const makeFresh = async () => {
    setFresh((current) => ({ ...current, working: true, problem: "" }));
    try {
      if (fresh.password.length < 8) throw new Error("the password must be at least 8 characters");
      const made = await vault.fresh(fresh.password);
      // The backup is saved before the address is used: without the file and its password, what is withdrawn there cannot be reached.
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([JSON.stringify(made.backup)], { type: "application/json" }));
      link.download = `ring-wallet-${made.address.slice(0, 6)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      setForm((current) => ({ ...current, to: made.address }));
      setFresh({ open: false, password: "", working: false, problem: "", made: made.address });
    } catch (error) {
      setFresh((current) => ({ ...current, working: false, problem: error instanceof Error ? error.message : String(error) }));
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
    run("Waiting for the chain to confirm", async (onSent): Promise<Outcome> => {
      const amount = parseAmount(form.amount, decimalsOf(form.mint)).toString();
      let outcome: Outcome;
      const progress = { sent: onSent, stage: setStage };
      if (tab === "deposit") {
        const sent = await backend.deposit(me, form.mint, BigInt(amount), progress);
        outcome = { message: `Deposited ${form.amount} ${symbol(form.mint)} into your Ring balance.`, signature: sent.signature };
      } else if (tab === "transfer") {
        const note = backend.notes ? await sealNoteFor(me, form.to.trim(), form.memo) : undefined;
        const sent = await backend.transfer(me, form.to.trim(), form.mint, BigInt(amount), note, progress);
        outcome = { message: `Sent ${form.amount} ${symbol(form.mint)}.`, ...(sent.signature ? { signature: sent.signature } : {}) };
      } else {
        const result = await backend.withdraw(me, form.mint, BigInt(amount), form.to.trim() || undefined, progress);
        outcome = result.pending
          ? {
              message:
                'The payout was sent but the chain has not confirmed it yet. Your balance stays reduced until it does. Use "Check for anything missing" in a minute.',
              signature: result.signature,
            }
          : { message: `Withdrew ${form.amount} ${symbol(form.mint)}.`, signature: result.signature };
      }
      setStage("");
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
      <div className="cols two">
        <section className="block" aria-label="Balances and actions">
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
                  const found = await signedApi("ring/recheck", me);
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
              Fund this address from any wallet or exchange. That transfer is public, like any other. The key exists only in this browser and in your backup
              file.
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

          <SolWorth wallet={inWallet ? (inWallet[NATIVE] ?? "0") : undefined} ring={mine ? (mine.balances[NATIVE] ?? "0") : undefined} />

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
            <Confirm
              actions={[tab]}
              label={tab === "withdraw" && planned ? "Start the split withdrawal" : `Sign and ${tab}`}
              busy={busy}
              onConfirm={() => (tab === "withdraw" && planned ? startSplit() : void submit())}
              onCancel={() => setReviewing(false)}
            >
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
              {tab === "withdraw" && planned && (
                <>
                  <p className="body">
                    It goes out as {planned.length} withdrawals of uneven amounts at uneven times. The first goes when you start; the rest are sent from this
                    page as they come due, so keep it open and unlocked, or come back to it.
                  </p>
                  <div className="table-wrap">
                    <table className="grid" data-planned>
                      <thead>
                        <tr>
                          <th>Part</th>
                          <th className="r">Amount</th>
                          <th>When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {planned.map((part, index) => (
                          <tr key={index}>
                            <td className="num">{index + 1}</td>
                            <td className="r num">
                              {formatCoin(form.mint, part.amount)} {symbol(form.mint)}
                            </td>
                            <td className="num">{part.afterMs === 0 ? "Now" : `In ${formatSpan(part.afterMs)}`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {tab === "withdraw" && (
                <p className="body">
                  The network fee comes out of the SOL in your Ring balance. If the destination has never held this coin, so does the rent for its account,
                  about 0.002 SOL.
                </p>
              )}
              {tab === "withdraw" &&
                withdrawalWarnings(mine?.history ?? [], {
                  wallet: me.address,
                  mint: form.mint,
                  amount: reviewedAmount(),
                  destination: form.to.trim(),
                  destinationSeen,
                  balance: mine ? BigInt(mine.balances[form.mint] ?? "0") : undefined,
                  parts: planned?.length ?? 1,
                }).map((warning) => (
                  <p key={warning} className="notice">
                    {warning}
                  </p>
                ))}
            </Confirm>
          ) : (
            <form
              className="form"
              onSubmit={(event) => {
                event.preventDefault();
                void review();
              }}
            >
              <div className="pair">
                <div className="field">
                  <label className="label" htmlFor="w-coin">
                    Coin
                  </label>
                  <Choice
                    id="w-coin"
                    label="Coin"
                    value={form.mint}
                    onChange={(mint) => setForm({ ...form, mint })}
                    options={mints.map((mint) => ({ value: mint, label: symbol(mint) }))}
                  />
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
              {tab === "withdraw" && (
                <>
                  <div className="actions">
                    {me.kind === "browser" && (
                      <button className="link" type="button" aria-expanded={fresh.open} onClick={() => setFresh({ ...fresh, open: !fresh.open, problem: "" })}>
                        Make a fresh address for this
                      </button>
                    )}
                    {fresh.made && form.to.trim() === fresh.made && (
                      <span className="quiet" role="status">
                        A new address, never used. Its backup file was saved to your downloads.
                      </span>
                    )}
                  </div>
                  {fresh.open && (
                    <div className="card" data-fresh>
                      <p className="body">
                        An address that has never appeared on the chain gives an observer nothing but itself. This makes one, saves its encrypted backup file,
                        and fills it in as the destination. That file and the password you choose here are the only way to use what you withdraw there: to open
                        it, lock this wallet and open the backup.
                      </p>
                      <div className="field">
                        <label className="label" htmlFor="w-fresh-password">
                          Password for the new address&apos;s backup
                        </label>
                        <input
                          id="w-fresh-password"
                          type="password"
                          autoComplete="new-password"
                          value={fresh.password}
                          onChange={(event) => setFresh({ ...fresh, password: event.target.value })}
                        />
                      </div>
                      <div className="actions">
                        <button className="btn" type="button" disabled={fresh.working} onClick={() => void makeFresh()}>
                          {fresh.working ? "Making it" : "Make it and save the backup"}
                        </button>
                      </div>
                      {fresh.problem && (
                        <p className="status-line bad" role="alert">
                          {fresh.problem}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="pair">
                    <div className="field">
                      <label className="label" htmlFor="w-parts">
                        Send it as
                      </label>
                      <Choice
                        id="w-parts"
                        label="Send it as"
                        value={split.parts}
                        onChange={(parts) => setSplit({ ...split, parts })}
                        options={[1, 2, 3, 4, 6, 8].map((parts) => ({ value: parts, label: parts === 1 ? "One withdrawal, now" : `${parts} uneven parts` }))}
                      />
                    </div>
                    {split.parts > 1 && (
                      <div className="field">
                        <label className="label" htmlFor="w-over">
                          Spread over
                        </label>
                        <Choice
                          id="w-over"
                          label="Spread over"
                          value={split.overMs}
                          onChange={(overMs) => setSplit({ ...split, overMs })}
                          options={SPREADS.map(([overMs, label]) => ({ value: overMs, label }))}
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
              {tab === "transfer" && backend.notes && (
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
          {stage && (
            <p className="status-line" role="status" data-stage>
              Now: {stage}.
            </p>
          )}
          {backend.registersOnChain && mine !== null && !mine.registered && (
            <div className="card" data-register>
              <h2 className="px">Register with the Ring</h2>
              <p className="body">
                Before this wallet can receive into a Ring balance it publishes its Ring keys in the Ring&apos;s registry. It is one public transaction from
                this wallet, once, and costs the registry record&apos;s rent and a network fee.
              </p>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run("Registering with the Ring", async (onSent) => {
                    await backend.register(me, { sent: onSent, stage: setStage });
                    setStage("");
                    await refresh();
                    return { message: "This wallet is registered with the Ring." };
                  })
                }
              >
                Register
              </button>
            </div>
          )}
          {queued && (
            <p className="status-line" role="status" data-queued>
              {queued}
            </p>
          )}
          {line}
          <WithdrawPlans me={me} backend={backend} symbol={symbol} version={planVersion} onChange={() => void refresh()} />
        </section>
        <section className="block" aria-label="History">
          <h2 className="h3">Your Ring history</h2>
          {mine === null && !loadProblem && <p className="body">Reading your history.</p>}
          {mine?.history.length === 0 && <p className="body">Nothing yet. A deposit, transfer or withdrawal will appear here.</p>}
          {mine !== null && mine.history.length > 0 && (
            <div className="table-wrap">
              <table className="grid" data-history>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>What</th>
                    <th>Public</th>
                    <th>Not published</th>
                    <th>State</th>
                    <th className="r">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.history.map((event) => (
                    <RingEventRow key={event.id} event={event} me={me.address} symbol={symbol} noteKeys={me.noteKeys} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2 className="h3">Your wallet&apos;s public transactions</h2>
          <p className="body">The latest transactions this wallet took part in, as anyone can list them from the chain.</p>
          <ActivityList load={loadActivity} version={mine?.history.length ?? 0} empty="None yet. Funding the wallet will be the first." />
        </section>
      </div>
    </>
  );
}
