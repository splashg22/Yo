import { NATIVE } from "@/lib/constants";
import type { RingEvent } from "@/lib/contract";
import { formatCoin, formatSol, formatTime } from "@/lib/format";
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

/** One entry of a wallet's own Ring history: the public part, then the part only its keys can read. */
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
  const who = (address: string | undefined) => (address === me ? "you" : <span className="address">{address}</span>);
  return (
    <li>
      <b>
        {TITLES[event.kind]}
        {event.pending ? ", payout not yet confirmed" : ""}
      </b>
      <span className="label">{formatTime(event.at)}</span>
      <span className="pub">
        Public: {event.kind === "register" && <>your wallet published its Ring keys.</>}
        {event.kind === "deposit" && (
          <>
            {formatCoin(open.coin!, open.amount!)} {symbol(open.coin!)} from {who(open.wallet)}.
          </>
        )}
        {event.kind === "withdraw" && (
          <>
            {formatCoin(open.coin!, open.amount!)} {symbol(open.coin!)} from {who(open.wallet)} to {who(open.destination)}.
          </>
        )}
        {event.kind === "transfer" && (
          <>
            a transfer from {who(open.from)} to {who(open.to)}.
          </>
        )}
        {event.kind === "otc" && (
          <>
            a transfer each way between {who(open.seller)} and {who(open.buyer)}.
          </>
        )}
      </span>
      {event.kind === "transfer" && (
        <span className="enc">
          Not published: {formatCoin(sealed.coin!, sealed.amount!)} {symbol(sealed.coin!)}.
        </span>
      )}
      {event.kind === "transfer" && sealedNote !== undefined && (
        <span className="enc">
          {note === undefined
            ? noteKeys
              ? "Opening the sealed note."
              : "There is a sealed note. Only a wallet made in this browser can open it."
            : note === null
              ? "There is a sealed note, but this wallet's key does not open it."
              : `Sealed note, readable only by you and the other wallet: "${note}"`}
        </span>
      )}
      {event.kind === "window" && (
        <span className="enc">
          Not published: you {sealed.did} {formatCoin(sealed.coin!, sealed.amount!)} {symbol(sealed.coin!)}
          {sealed.returned && sealed.returned !== "0" ? `, and ${formatSol(sealed.returned, 9)} came back unspent` : ""}.
        </span>
      )}
      {event.kind === "otc" && (
        <span className="enc">
          Not published: {formatCoin(sealed.coin!, sealed.size!)} {symbol(sealed.coin!)} for {formatSol(sealed.price!, 9)}
          {sealed.paidIn === NATIVE ? "" : ` in ${symbol(sealed.paidIn!)}`}.
        </span>
      )}
      {event.signature && (
        <Link className="link" href={`/tx/${event.signature}`}>
          Receipt
        </Link>
      )}
    </li>
  );
}
