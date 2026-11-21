/**
 * Requests that change something are signed by the wallet, as a transaction would be.
 * The same code signs in the browser and verifies on the server.
 */
import { fromBase64, toBase64, utf8 } from "./bytes";
import { verifyMessage } from "./keys";

const DOMAIN = "RING APP REQUEST v1\n";

/** Sorted keys, no whitespace: the same request always signs the same bytes. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface Signed<T> {
  body: T & { wallet: string; nonce: string; at: number; op: string };
  signature: string;
}
export const messageFor = (body: unknown): Uint8Array => utf8(DOMAIN + canonical(body));

export async function signRequest<T extends object>(
  op: string, wallet: string, payload: T, sign: (message: Uint8Array) => Promise<Uint8Array> | Uint8Array, now = Date.now(),
): Promise<Signed<T>> {
  const nonce = toBase64(globalThis.crypto.getRandomValues(new Uint8Array(12)));
  const body = { ...payload, wallet, nonce, at: now, op };
  return { body, signature: toBase64(await sign(messageFor(body))) };
}

/** Throws unless the request is signed by the wallet it names, for this operation, just now, for the first time. */
export function verifyRequest<T>(op: string, request: Signed<T>, usedNonces: string[], now = Date.now()): Signed<T>["body"] {
  const { body, signature } = request ?? ({} as Signed<T>);
  if (!body || typeof body.wallet !== "string" || typeof signature !== "string") throw new Error("this request must be signed by a wallet");
  if (body.op !== op) throw new Error("the signature is for a different action");
  if (Math.abs(now - body.at) > 90_000) throw new Error("the request is too old, sign it again");
  let ok = false;
  try { ok = verifyMessage(body.wallet, messageFor(body), fromBase64(signature)); } catch { /* not a signature */ }
  if (!ok) throw new Error("the signature does not match the wallet");
  const key = `${body.wallet}:${body.nonce}`;
  if (usedNonces.includes(key)) throw new Error("this request was already used");
  usedNonces.push(key);
  if (usedNonces.length > 5_000) usedNonces.splice(0, usedNonces.length - 5_000);
  return body;
}
