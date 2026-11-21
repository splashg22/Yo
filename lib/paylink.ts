/**
 * Pay links: a link that asks for an amount of a coin and opens a Ring transfer with it
 * filled in. Anyone holding the link can read what it asks for. On-chain, the payment
 * shows the payer and the recipient and seals the coin and the amount.
 */
import bs58 from "bs58";

export interface PayRequest {
  to: string;
  mint: string;
  /** Base units. */
  amount: string;
  memo?: string;
}
const isAddress = (text: string) => {
  try { return bs58.decode(text).length === 32; } catch { return false; }
};

export function payLink(origin: string, request: PayRequest): string {
  const checked = checkPayRequest(request);
  const url = new URL("/pay", origin);
  url.searchParams.set("to", checked.to);
  url.searchParams.set("coin", checked.mint);
  url.searchParams.set("amount", checked.amount);
  if (checked.memo) url.searchParams.set("memo", checked.memo);
  return url.toString();
}

export function checkPayRequest(request: Partial<PayRequest>): PayRequest {
  if (!request.to || !isAddress(request.to)) throw new Error("the link has no valid recipient");
  if (!request.mint || !isAddress(request.mint)) throw new Error("the link has no valid coin");
  if (!request.amount || !/^[1-9]\d{0,29}$/.test(request.amount)) throw new Error("the link has no valid amount");
  const memo = request.memo?.trim().slice(0, 140) || undefined;
  return { to: request.to, mint: request.mint, amount: request.amount, memo };
}

export function parsePayLink(link: string): PayRequest {
  let url: URL;
  try { url = new URL(link, "http://localhost"); } catch { throw new Error("that is not a link"); }
  const p = url.searchParams;
  return checkPayRequest({ to: p.get("to") ?? undefined, mint: p.get("coin") ?? undefined, amount: p.get("amount") ?? undefined, memo: p.get("memo") ?? undefined });
}
