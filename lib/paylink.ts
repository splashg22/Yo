/**
 * Pay links: a link that asks for an amount of a coin and opens a Ring transfer with it
 * filled in. Anyone holding the link can read what it asks for.
 *
 * The request is carried after the # of the address. A browser never sends that part to a
 * server, so this site's server, its logs and anything in between do not see who is asking
 * whom for how much. Only the person the link is given to does.
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
  try {
    return bs58.decode(text).length === 32;
  } catch {
    return false;
  }
};

export function payLink(origin: string, request: PayRequest): string {
  const checked = checkPayRequest(request);
  const url = new URL("/pay", origin);
  const request_ = new URLSearchParams({ to: checked.to, coin: checked.mint, amount: checked.amount });
  if (checked.memo) request_.set("memo", checked.memo);
  url.hash = request_.toString();
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
  try {
    url = new URL(link, "http://localhost");
  } catch {
    throw new Error("that is not a link");
  }
  // A request in the query string would reach the server. Such a link is not one of ours, and is not honoured.
  if (url.search) throw new Error("the link is not a valid pay link");
  const p = new URLSearchParams(url.hash.slice(1));
  return checkPayRequest({
    to: p.get("to") ?? undefined,
    mint: p.get("coin") ?? undefined,
    amount: p.get("amount") ?? undefined,
    memo: p.get("memo") ?? undefined,
  });
}
