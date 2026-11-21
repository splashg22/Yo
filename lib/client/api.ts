/** Talks to this site's own server, with every operation typed by lib/contract.ts. */
import { signRequest } from "../auth";
import type { Api, OpenOpName, Settlement, SignedOpName } from "../contract";

export interface Signer {
  kind: "browser" | "extension";
  label: string;
  address: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  /** Signs a transaction (base64 in, base64 out). `extraSeeds` are keys made for this one transaction, such as a new coin's. */
  signTransaction: (transaction: string, extraSeeds?: Uint8Array[]) => Promise<string>;
}

/** The server answered, and said no. `offline` means the chain could not be reached, so nothing was sent. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly offline: boolean,
  ) {
    super(message);
  }
}

async function post<Output>(name: string, payload: object): Promise<Output> {
  let response: Response;
  try {
    response = await fetch(`/api/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  } catch {
    throw new ApiError("this site's server is not answering. Check your connection and try again.", true);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body !== null && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : `the server answered ${response.status}`;
    throw new ApiError(message, response.status === 503);
  }
  return body as Output;
}

export const api = <Name extends OpenOpName>(name: Name, payload: Api[Name]["input"] = {}): Promise<Api[Name]["output"]> => post(name, payload);

/** A request signed by the wallet, for anything that reads or moves its Ring balance. */
export async function signedApi<Name extends SignedOpName>(name: Name, signer: Signer, payload: Api[Name]["input"] = {}): Promise<Api[Name]["output"]> {
  return post(name, await signRequest(name, signer.address, payload, (message) => signer.signMessage(message)));
}

/** Signs a transaction the server built and has the server submit and settle it. */
export async function signAndSend(signer: Signer, transaction: string, extraSeeds?: Uint8Array[]): Promise<{ signature: string } & Settlement> {
  return api("tx/send", { transaction: await signer.signTransaction(transaction, extraSeeds) });
}
