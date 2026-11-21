/** Talks to this site's own server, with every operation typed by lib/contract.ts. */
import { signRequest } from "../auth";
import type { NoteKeys } from "../notes";
import type { Api, OpenOpName, SessionOpName, Settlement, SignedOpName } from "../contract";

export interface Signer {
  kind: "browser" | "extension";
  label: string;
  address: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  /** Signs a transaction (base64 in, base64 out). `extraSeeds` are keys made for this one transaction, such as a new coin's. */
  signTransaction: (transaction: string, extraSeeds?: Uint8Array[]) => Promise<string>;
  /** The key pair for sealing and opening notes. Only a wallet made in this browser has one: it is derived from the wallet's seed. */
  noteKeys?: () => Promise<NoteKeys>;
  /**
   * The wallet's session with this site: opened by one signature, then good for reading the wallet's own records.
   * `ask: false` never prompts: if the session has ended and opening a new one would need the person, it throws instead.
   */
  session: (options?: { ask?: boolean }) => Promise<string>;
}
/** The session ended and a new one needs the person: shown as a "sign in again" button, never asked for on a timer. */
export class SessionEnded extends Error {
  constructor() {
    super("your session has ended. Sign in with your wallet again.");
  }
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

/**
 * Reads the wallet's own records with its session: no signature, so a page may ask as often as it likes.
 * `ask: false` (the default) is for refreshes: it never opens a wallet prompt.
 */
export async function sessionApi<Name extends SessionOpName>(
  name: Name,
  signer: Signer,
  payload: Api[Name]["input"] = {},
  options: { ask?: boolean } = {},
): Promise<Api[Name]["output"]> {
  const once = async (): Promise<Api[Name]["output"]> => post(name, { ...payload, session: await signer.session({ ask: options.ask ?? false }) });
  try {
    return await once();
  } catch (error) {
    // The server restarted, or the session ran out between the check and the request: open another, once.
    if (!(error instanceof ApiError) || !/session has ended/.test(error.message)) throw error;
    return once();
  }
}

/**
 * Signs a transaction the server built, hands it over, and waits for the chain's verdict.
 * `onSent` is called with the signature as soon as the network has it, so the page can say so while it waits.
 */
export async function signAndSend(
  signer: Signer,
  transaction: string,
  extraSeeds?: Uint8Array[],
  onSent?: (signature: string) => void,
): Promise<{ signature: string } & Settlement> {
  let outcome = await api("tx/send", { transaction: await signer.signTransaction(transaction, extraSeeds) });
  onSent?.(outcome.signature);
  // The wait is asked for in slices, so no single request hangs for long and a dropped one costs nothing.
  for (let asked = 0; outcome.state === "sent" && asked < 8; asked++) outcome = await api("tx/wait", { signature: outcome.signature, ms: 20_000 });
  if (outcome.state === "sent") throw new ApiError("the transaction was sent but the chain has not confirmed it yet. Its receipt will show the result.", false);
  if (outcome.state !== "confirmed") throw new ApiError(outcome.problem ?? "the transaction did not go through", false);
  return { signature: outcome.signature, credited: outcome.settlement?.credited ?? [], listed: outcome.settlement?.listed ?? [] };
}
