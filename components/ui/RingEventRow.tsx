import { NATIVE } from "@/lib/constants";
import type { RingEvent } from "@/lib/contract";
import { formatCoin, formatSol, formatTime } from "@/lib/format";
import Link from "next/link";

const TITLES: Record<RingEvent["kind"], string> = {
  register: "Registered with the Ring",
  deposit: "Deposit",
  transfer: "Transfer",
  withdraw: "Withdrawal",
  otc: "OTC block",
};

/** One entry of a wallet's own Ring history: the public part, then the part only its keys can read. */
export function RingEventRow({ event, me, symbol }: { event: RingEvent; me: string; symbol: (mint: string) => string }) {
  const { public: open, sealed } = event;
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
          Encrypted: {formatCoin(sealed.coin!, sealed.amount!)} {symbol(sealed.coin!)}
          {sealed.memo ? `, memo "${sealed.memo}"` : ""}.
        </span>
      )}
      {event.kind === "otc" && (
        <span className="enc">
          Encrypted: {formatCoin(sealed.coin!, sealed.size!)} {symbol(sealed.coin!)} for {formatSol(sealed.price!, 9)}
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
