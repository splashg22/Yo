/** The sentence that says what this site charges for an action, shown where the action is confirmed. Empty when it charges nothing. */
import type { Config } from "./contract";
import { formatSol, shortAddress } from "./format";

const percent = (bps: number): string => `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

export function feeText(action: string, fees: Config["fees"]): string {
  if (!fees.wallet) return "";
  // The fee is its own instruction in the same transaction: a public transfer from the paying wallet to the fee wallet.
  const where = `It is a public transfer to ${shortAddress(fees.wallet)}, in the same transaction.`;
  if (action === "curve-trade" && fees.tradeBps > 0)
    return `This site's fee: ${percent(fees.tradeBps)} of the trade, paid in SOL by the trading wallet. ${where}`;
  if (action === "launch" && BigInt(fees.launchLamports) > 0n)
    return `This site's fee: ${formatSol(fees.launchLamports)} for the launch, paid by the creator. ${where}`;
  if (action === "otc" && fees.otcBps > 0) return `This site's fee: ${percent(fees.otcBps)} of the price, paid by the buyer on top of it. ${where}`;
  return "";
}
