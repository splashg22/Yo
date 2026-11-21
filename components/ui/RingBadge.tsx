import type { CoinView } from "@/lib/contract";
import { formatShare } from "@/lib/format";

/** The privacy score: two public facts, each named for exactly what it measures. */
export function RingBadge({ privacy }: { privacy: CoinView["privacy"] }) {
  const wallets = privacy.walletsThatDeposited;
  return (
    <span className="badge">
      <b>{formatShare(privacy.shareInRingPartsPerMillion)}</b> of supply in Ring balances <span className="sep" aria-hidden="true" /> <b>{wallets}</b>{" "}
      {wallets === 1 ? "wallet has" : "wallets have"} deposited it
    </span>
  );
}
