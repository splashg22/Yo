"use client";

/**
 * Split withdrawals in progress: every part, when it is due and what became of it. This component also carries
 * them out: while the page is open and the wallet unlocked, a part that is due is withdrawn.
 *
 * Only the wallet kept in this browser sends parts by itself. A wallet extension is asked to sign only when its
 * owner presses a button, so with one, a due part waits for "Send this part".
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Signer } from "@/lib/client/api";
import type { RingBackend } from "@/lib/client/ring";
import { loadPlans, nextDue, planOutstanding, planOver, savePlans, withPart, type QueuedPart, type QueuedPlan } from "@/lib/client/withdraw-queue";
import { formatCoin, formatTime } from "@/lib/format";
import { useTx } from "../tx/Tx";
import { Time, useNow } from "../ui/Money";

const STATE_TEXT: Record<QueuedPart["state"], string> = {
  waiting: "Waiting",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  interrupted: "Interrupted",
};

export function WithdrawPlans({
  me,
  backend,
  symbol,
  version,
  onChange,
}: {
  me: Signer;
  backend: RingBackend;
  symbol: (mint: string) => string;
  /** Changes when a plan was added from outside, so the list is read again. */
  version: number;
  /** A part was sent or failed: balances and history are stale. */
  onChange: () => void;
}) {
  const { begin } = useTx();
  const [plans, setPlans] = useState<QueuedPlan[]>([]);
  const now = useNow();
  const working = useRef(false);
  const automatic = me.kind === "browser";

  useEffect(() => {
    setPlans(loadPlans(me.address));
  }, [me.address, version]);
  const change = useCallback(
    (next: (current: QueuedPlan[]) => QueuedPlan[]) => {
      // Read from storage, not from this render: another tab on the same wallet may have moved a part on.
      const updated = next(loadPlans(me.address));
      savePlans(me.address, updated);
      setPlans(updated);
    },
    [me.address],
  );

  const send = useCallback(
    async (plan: QueuedPlan, index: number) => {
      if (working.current) return;
      working.current = true;
      const part = plan.parts[index]!;
      const label = `Withdrawing part ${index + 1} of ${plan.parts.length}: ${formatCoin(plan.mint, part.amount)} ${symbol(plan.mint)}`;
      const entry = begin(label);
      // Written down as "sending" before anything leaves: if the page closes now, the part is shown as interrupted, not sent twice.
      change((current) => withPart(current, plan.id, index, { state: "sending", startedAt: Date.now(), problem: undefined }));
      try {
        const result = await backend.withdraw(me, plan.mint, BigInt(part.amount), plan.destination || undefined, { sent: entry.sent });
        change((current) => withPart(current, plan.id, index, { state: "sent", signature: result.signature }));
        entry.confirmed(`Part ${index + 1} of ${plan.parts.length} withdrawn: ${formatCoin(plan.mint, part.amount)} ${symbol(plan.mint)}.`, result.signature);
      } catch (error) {
        const problem = error instanceof Error ? error.message : String(error);
        change((current) => withPart(current, plan.id, index, { state: "failed", problem }));
        entry.failed(`Part ${index + 1} was not withdrawn: ${problem}`);
      } finally {
        working.current = false;
        onChange();
      }
    },
    [backend, begin, change, me, onChange, symbol],
  );

  // The runner: once a second (the shared clock), the earliest due part goes, one at a time.
  useEffect(() => {
    if (working.current) return;
    // A part this tab is not sending is being sent by another tab, or was cut off: storage says which, in time.
    if (plans.some((plan) => plan.parts.some((part) => part.state === "sending"))) {
      const stored = loadPlans(me.address);
      if (JSON.stringify(stored) !== JSON.stringify(plans)) setPlans(stored);
      return;
    }
    if (!automatic) return;
    const due = nextDue(plans, Date.now());
    if (!due) return;
    const plan = plans.find((entry) => entry.id === due.plan);
    if (plan) void send(plan, due.index);
  }, [automatic, plans, now, send, me.address]);

  const open = plans.filter((plan) => !planOver(plan));
  const finished = plans.filter(planOver);
  if (plans.length === 0) return null;
  return (
    <div className="card" data-plans>
      <h2 className="px">Split withdrawals</h2>
      {open.length > 0 && (
        <p className="body">
          {automatic
            ? "Parts are sent from this page while it is open and the wallet is unlocked. A part that comes due while the page is closed or locked is sent when you are next here."
            : "Your wallet extension is asked to sign only when you press a button, so each part waits for you once it is due."}
        </p>
      )}
      {[...open, ...finished].map((plan) => (
        <div key={plan.id} data-plan={plan.id}>
          <p className="body">
            <b className="num">
              {formatCoin(
                plan.mint,
                plan.parts.reduce((sum, part) => sum + BigInt(part.amount), 0n),
              )}{" "}
              {symbol(plan.mint)}
            </b>{" "}
            to {plan.destination ? <span className="address">{plan.destination}</span> : "your own wallet"}, in {plan.parts.length} parts.{" "}
            {planOver(plan) ? "All sent." : `${formatCoin(plan.mint, planOutstanding(plan))} ${symbol(plan.mint)} still to go.`}
          </p>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Part</th>
                  <th className="r">Amount</th>
                  <th>Due</th>
                  <th>State</th>
                  <th className="r">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {plan.parts.map((part, index) => (
                  <tr key={index} data-part={part.state}>
                    <td className="num">{index + 1}</td>
                    <td className="r num">{formatCoin(plan.mint, part.amount)}</td>
                    <td>{part.state === "waiting" && part.dueAt > now ? <span className="num">{formatTime(part.dueAt)}</span> : <Time at={part.dueAt} />}</td>
                    <td>
                      {STATE_TEXT[part.state]}
                      {part.state === "failed" && part.problem ? <span className="quiet">: {part.problem}</span> : null}
                      {part.state === "interrupted" ? (
                        <span className="quiet">: the page closed while this part was being sent. Look for it in your history before sending it again.</span>
                      ) : null}{" "}
                      {(part.state === "failed" || part.state === "interrupted" || (!automatic && part.state === "waiting" && part.dueAt <= now)) && (
                        <button className="link" type="button" onClick={() => void send(plan, index)}>
                          {part.state === "waiting" ? "Send this part" : "Send it again"}
                        </button>
                      )}{" "}
                      {part.state === "interrupted" && (
                        <button className="link" type="button" onClick={() => change((current) => withPart(current, plan.id, index, { state: "sent" }))}>
                          It is in my history
                        </button>
                      )}
                    </td>
                    <td className="r">
                      {part.signature ? (
                        <Link className="link" href={`/tx/${part.signature}`}>
                          Receipt
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button className="link" type="button" onClick={() => change((current) => current.filter((entry) => entry.id !== plan.id))}>
              {planOver(plan) ? "Clear from this list" : "Cancel the parts not yet sent"}
            </button>
          </div>
        </div>
      ))}
      <p className="note-line">
        The parts are public withdrawals like any other, and they add up. Splitting makes matching by amount and time harder; it does not hide the wallet, the
        destination or the coin. The plan is kept in this browser only.
      </p>
    </div>
  );
}
