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
    return `{${entries
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface Signed<T> {
  body: T & { wallet: string; nonce: string; at: number; op: string };
  signature: string;
}
export const messageFor = (body: unknown): Uint8Array => utf8(DOMAIN + canonical(body));

export async function signRequest<T extends object>(
  op: string,
  wallet: string,
  payload: T,
  sign: (message: Uint8Array) => Promise<Uint8Array> | Uint8Array,
  now = Date.now(),
): Promise<Signed<T>> {
  const nonce = toBase64(globalThis.crypto.getRandomValues(new Uint8Array(12)));
  const body = { ...payload, wallet, nonce, at: now, op };
  return { body, signature: toBase64(await sign(messageFor(body))) };
}

/** How long a signed request stays valid, and how far ahead of the server a browser's clock may run. */
const VALID_FOR_MS = 90_000;
const CLOCK_AHEAD_MS = 30_000;

/**
 * Throws unless the request is signed by the wallet it names, for this operation, just now, for the first time.
 *
 * `usedNonces` remembers each request until it could no longer be accepted anyway. It is cleared by age and
 * never by count, so however many requests arrive, one that is still inside its time window is still remembered.
 */
export function verifyRequest<T>(op: string, request: Signed<T>, usedNonces: string[], now = Date.now()): Signed<T>["body"] {
  const { body, signature } = request ?? ({} as Signed<T>);
  if (!body || typeof body.wallet !== "string" || typeof signature !== "string") throw new Error("this request must be signed by a wallet");
  if (body.op !== op) throw new Error("the signature is for a different action");
  // A time that is not a number would compare false against every limit and never expire.
  if (typeof body.at !== "number" || !Number.isFinite(body.at) || typeof body.nonce !== "string" || body.nonce.length < 8 || body.nonce.length > 64)
    throw new Error("this request must be signed by a wallet");
  if (now - body.at > VALID_FOR_MS || body.at - now > CLOCK_AHEAD_MS) throw new Error("the request is too old, sign it again");
  let ok = false;
  try {
    ok = verifyMessage(body.wallet, messageFor(body), fromBase64(signature));
  } catch {
    /* not a signature */
  }
  if (!ok) throw new Error("the signature does not match the wallet");
  // Each entry is "<time>|<wallet>:<nonce>". Entries too old to be replayed are dropped; older formats with no time are dropped too.
  const fresh = usedNonces.filter((entry) => now - Number(entry.split("|")[0]) <= VALID_FOR_MS);
  usedNonces.splice(0, usedNonces.length, ...fresh);
  const key = `${body.wallet}:${body.nonce}`;
  if (usedNonces.some((entry) => entry.slice(entry.indexOf("|") + 1) === key)) throw new Error("this request was already used");
  usedNonces.push(`${body.at}|${key}`);
  return body;
}
