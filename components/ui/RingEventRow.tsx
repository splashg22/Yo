import { NATIVE } from "@/lib/constants";
import type { RingEvent } from "@/lib/contract";
import { formatCoin, formatSol, shortAddress } from "@/lib/format";
import { Time } from "./Money";
import Link from "next/link";
import { useEffect, useState } from "react";
import { openNote, type NoteKeys } from "@/lib/notes";

const TITLES: Record<RingEvent["kind"], string> = {
  register: "Registered with the Ring",
  deposit: "Deposit",
  transfer: "Transfer",
  withdraw: "Withdrawal",
  otc: "OTC block",
  window: "Sealed window",
};

/** One row of a wallet's own Ring history: when, what, the public part, the part only its keys can read, how it stands, and its receipt. */
export function RingEventRow({
  event,
  me,
  symbol,
  noteKeys,
}: {
  event: RingEvent;
  me: string;
  symbol: (mint: string) => string;
  noteKeys?: () => Promise<NoteKeys>;
}) {
  const { public: open, sealed } = event;
  // A note is stored sealed. It is opened here, in the browser, with this wallet's own key.
  const sealedNote = open.from === me ? sealed.noteForSender : sealed.noteForRecipient;
  const [note, setNote] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (sealedNote === undefined || !noteKeys) return;
    let current = true;
    void noteKeys()
      .then((keys) => openNote(sealedNote, keys))
      .then((text) => current && setNote(text));
    return () => {
      current = false;
    };
  }, [sealedNote, noteKeys]);
  const who = (address: string | undefined) =>
    address === me ? (
      "you"
    ) : (
      <span className="address" title={address}>
        {shortAddress(address ?? "")}
      </span>
    );
  return (
    <tr data-event={event.kind}>
      <td>{event.at > 0 ? <Time at={event.at} /> : <span className="num">Slot {open.slot ?? "unknown"}</span>}</td>
      <td>
        <b>{TITLES[event.kind]}</b>
      </td>
      <td className="pub" style={{ whiteSpace: "normal" }}>
        {event.kind === "register" && <>Your wallet published its Ring keys.</>}
        {event.kind === "deposit" && (
          <>
            {formatCoin(open.coin!, open.amount!)} {symbol(open.coin!)} from {who(open.wallet)}.
          </>
        )}
        {event.kind === "withdraw" && (
          <>
            {formatCoin(open.coin!, open.amount!)} {symbol(open.coin!)} from {who(open.wallet)}
            {open.destination ? <> to {who(open.destination)}</> : null}.
          </>
        )}
        {event.kind === "transfer" && (
          <>
            A transfer from {who(open.from)}
            {open.to ? <> to {who(open.to)}</> : null}.
          </>
        )}
        {event.kind === "otc" && (
          <>
            A transfer each way between {who(open.seller)} and {who(open.buyer)}.
          </>
        )}
        {event.kind === "window" && <>A sealed launch window.</>}
      </td>
      <td className="enc" style={{ whiteSpace: "normal" }}>
        {event.kind === "transfer" && (
          <>
            {formatCoin(sealed.coin!, sealed.amount!)} {symbol(sealed.coin!)}.
          </>
        )}
        {event.kind === "transfer" && sealedNote !== undefined && (
          <>
            {" "}
            {note === undefined
              ? noteKeys
                ? "Opening the sealed note."
                : "There is a sealed note. Only a wallet made in this browser can open it."
              : note === null
                ? "There is a sealed note, but this wallet's key does not open it."
                : `Sealed note, readable only by you and the other wallet: "${note}"`}
          </>
        )}
        {event.kind === "window" && (
          <>
            You {sealed.did} {formatCoin(sealed.coin!, sealed.amount!)} {symbol(sealed.coin!)}
            {sealed.returned && sealed.returned !== "0" ? `, and ${formatSol(sealed.returned, 9)} came back unspent` : ""}.
          </>
        )}
        {event.kind === "otc" && (
          <>
            {formatCoin(sealed.coin!, sealed.size!)} {symbol(sealed.coin!)} for {formatSol(sealed.price!, 9)}
            {sealed.paidIn === NATIVE ? "" : ` in ${symbol(sealed.paidIn!)}`}.
          </>
        )}
        {(event.kind === "deposit" || event.kind === "withdraw" || event.kind === "register") && <span className="quiet">Nothing</span>}
      </td>
      <td>{event.pending ? <span className="tag hot">Payout pending</span> : <span className="tag">Confirmed</span>}</td>
      <td className="r">
        {event.signature ? (
          <Link className="link" href={`/tx/${event.signature}`}>
            Receipt
          </Link>
        ) : (
          <span className="quiet" title="A move between Ring balances has no public transaction of its own in this build.">
            None
          </span>
        )}
      </td>
    </tr>
  );
}
