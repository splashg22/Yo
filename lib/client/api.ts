/** Talks to this site's own server. Nothing here knows an RPC address or a key belonging to anyone else. */
import { signRequest } from "../auth";

export interface Signer {
  kind: "browser" | "extension";
  label: string;
  address: string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  /** Signs a transaction (base64 in, base64 out). `extraSeeds` are keys made for this one transaction, such as a new coin's. */
  signTransaction(transaction: string, extraSeeds?: Uint8Array[]): Promise<string>;
}

export async function api<T = any>(op: string, payload?: object): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const response = await fetch(`/api/${op}`, payload ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : undefined);
  const body = await response.json().catch(() => ({ error: `the server answered ${response.status}` }));
  if (!response.ok) throw new Error(body.error ?? "the request failed");
  return body as T;
}
/** A request signed by the wallet, for anything that reads or moves its Ring balance. */
export const signedApi = async <T = any>(op: string, signer: Signer, payload: object = {}): Promise<T> => // eslint-disable-line @typescript-eslint/no-explicit-any
  api<T>(op, await signRequest(op, signer.address, payload, (m) => signer.signMessage(m)));

/** Signs a transaction the server built and has the server submit it. Returns its signature. */
export async function signAndSend(signer: Signer, transaction: string, extraSeeds?: Uint8Array[]): Promise<string> {
  const { signature } = await api<{ signature: string }>("tx/send", { transaction: await signer.signTransaction(transaction, extraSeeds) });
  return signature;
}
