/**
 * The vault: the only place an unlocked wallet key exists. It runs in a worker of its own.
 *
 * - The key is made, unlocked and used here. It is never posted to the page, never written to storage.
 *   What the page gets back is signatures.
 * - The slow step, turning the password into a key, runs here, so the page stays responsive and can show progress.
 * - It locks itself after a stretch with no use: the key is overwritten and the page is told.
 *
 * Reloading the page ends the worker. So that a reload does not mean typing the password again, the key is
 * also kept sealed: encrypted under a WebCrypto key that cannot be exported, which lives in IndexedDB and is
 * used only here. The sealed copy sits in the tab's session storage and carries the time it stops being good
 * (the idle limit). Locking deletes the WebCrypto key, which makes any sealed copy left behind useless.
 *
 * What this does and does not give: the wallet key is never readable in storage and never in the page's
 * memory. A script injected into the page while the wallet is unlocked could still ask this worker to sign;
 * the site's content policy is what keeps such a script out.
 */
import { decryptBackup, encryptBackup, type Backup } from "../backup";
import { actorFromSeed, newActor, signMessage, type Actor } from "../keys";
import { noteKeysFor } from "../notes";
import { signTransaction } from "../sign";

export type VaultRequest =
  | { op: "create"; password: string }
  | { op: "unlock"; backup: unknown; password: string }
  | { op: "resume"; kept: Kept }
  | { op: "lock" }
  | { op: "address" }
  | { op: "signMessage"; message: Uint8Array }
  | { op: "signTransaction"; transaction: string; extraSeeds: Uint8Array[] }
  | { op: "noteKeys" }
  | { op: "autoLock"; minutes: number }
  | { op: "touch" };
/** What the page keeps in session storage: which sealing key, and the sealed wallet key. Useless without the worker's IndexedDB key. */
export interface Kept {
  keyId: string;
  nonce: string;
  sealed: string;
}
export type VaultEvent =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string } | { id: number; progress: number } | { locked: "idle" | "asked" };

let actor: Actor | null = null;
let keyId: string | null = null;
let idleMinutes = 15;

// ---- the sealing key: a WebCrypto key that cannot be exported, kept in IndexedDB --------------------
const DB = "ring-vault";
const STORE = "keys";
const DAY_MS = 86_400_000;
function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(STORE);
    opening.onerror = () => reject(new Error("this browser would not open the wallet's key store"));
    opening.onsuccess = () => resolve(opening.result.transaction(STORE, mode).objectStore(STORE));
  });
}
const done = <Result>(request: IDBRequest<Result>): Promise<Result> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("the wallet's key store did not answer"));
  });
const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

/** Seals the unlocked key for this tab, good until the idle limit from now. Returns null where the browser has no key store. */
async function seal(): Promise<Kept | null> {
  if (!actor) return null;
  try {
    const keys = await store("readwrite");
    let entry = keyId ? await done(keys.get(keyId) as IDBRequest<{ key: CryptoKey; made: number } | undefined>) : undefined;
    if (!entry || !keyId) {
      keyId = crypto.randomUUID();
      entry = { key: await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]), made: Date.now() };
      await done((await store("readwrite")).put(entry, keyId));
    }
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const until = idleMinutes > 0 ? Date.now() + idleMinutes * 60_000 : Date.now() + DAY_MS;
    const body = new Uint8Array(40);
    body.set(actor.seed, 0);
    new DataView(body.buffer).setFloat64(32, until);
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, entry.key, body));
    body.fill(0);
    return { keyId, nonce: b64(nonce), sealed: b64(sealed) };
  } catch {
    return null; // no key store (a private window, say): the wallet still works, it just asks for the password after a reload
  }
}
async function unseal(kept: Kept): Promise<Actor | null> {
  try {
    const entry = await done((await store("readonly")).get(kept.keyId) as IDBRequest<{ key: CryptoKey } | undefined>);
    if (!entry) return null;
    const body = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(kept.nonce) }, entry.key, unb64(kept.sealed)));
    const until = new DataView(body.buffer).getFloat64(32);
    const opened = Date.now() < until ? actorFromSeed(body.subarray(0, 32)) : null;
    body.fill(0);
    if (opened) keyId = kept.keyId;
    else await forgetKey(kept.keyId);
    return opened;
  } catch {
    return null;
  }
}
async function forgetKey(id: string | null): Promise<void> {
  try {
    const keys = await store("readwrite");
    if (id) await done(keys.delete(id));
    // Sealing keys of tabs that were closed without locking are cleared once they are a day old.
    const all = await done((await store("readonly")).getAllKeys());
    for (const other of all) {
      const entry = await done((await store("readonly")).get(other) as IDBRequest<{ made?: number } | undefined>);
      if (!entry?.made || Date.now() - entry.made > DAY_MS) await done((await store("readwrite")).delete(other));
    }
  } catch {
    /* nothing to forget */
  }
}
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const post = (event: VaultEvent): void => (self as unknown as { postMessage(message: VaultEvent): void }).postMessage(event);

function lock(reason: "idle" | "asked"): void {
  clearTimeout(idleTimer);
  if (!actor) return;
  actor.seed.fill(0); // the bytes are overwritten, not just dropped
  actor = null;
  void forgetKey(keyId); // without it, a sealed copy left in the tab's storage opens nothing
  keyId = null;
  post({ locked: reason });
}
function used(): void {
  clearTimeout(idleTimer);
  if (actor && idleMinutes > 0) idleTimer = setTimeout(() => lock("idle"), idleMinutes * 60_000);
}
function unlocked(): Actor {
  if (!actor) throw new Error("the wallet is locked. Unlock it with your password.");
  used();
  return actor;
}

async function handle(id: number, request: VaultRequest): Promise<unknown> {
  const progress = (share: number): void => post({ id, progress: share });
  switch (request.op) {
    case "create": {
      const made = newActor();
      const backup: Backup = encryptBackup(made, request.password, undefined, progress);
      actor = made;
      used();
      return { address: made.address, backup, kept: await seal() };
    }
    case "unlock": {
      const opened = decryptBackup(request.backup, request.password, progress);
      actor = actorFromSeed(opened.seed);
      used();
      return { address: actor.address, kept: await seal() };
    }
    case "resume": {
      actor = await unseal(request.kept);
      used();
      // Sealed afresh, so the time it stays good runs from now.
      return actor ? { address: actor.address, kept: await seal() } : null;
    }
    case "lock":
      lock("asked");
      return null;
    case "address":
      return actor?.address ?? null;
    case "signMessage":
      return signMessage(unlocked(), request.message);
    case "signTransaction":
      return signTransaction(request.transaction, [unlocked().seed, ...request.extraSeeds]);
    case "noteKeys":
      // The note keys are a pair derived from the wallet key for sealing and opening notes. They can read notes; they cannot move anything.
      return noteKeysFor(unlocked().seed);
    case "autoLock":
      if (!Number.isFinite(request.minutes) || request.minutes < 0 || request.minutes > 24 * 60) throw new Error("the auto-lock time is out of range");
      idleMinutes = request.minutes;
      used();
      return seal();
    case "touch":
      used();
      return seal();
  }
}

self.addEventListener("message", (event: MessageEvent<{ id: number; request: VaultRequest }>) => {
  const { id, request } = event.data;
  handle(id, request).then(
    (result) => post({ id, ok: true, result }),
    (error: unknown) => post({ id, ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
});
