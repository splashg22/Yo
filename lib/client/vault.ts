/** The page's side of the vault worker: asks it to make, unlock and use the wallet key, and never sees the key. */
import type { Backup } from "../backup";
import type { NoteKeys } from "../notes";
import type { Kept, VaultEvent, VaultRequest } from "./vault.worker";

export const AUTO_LOCK_CHOICES = [5, 15, 60, 0] as const; // minutes; 0 is never
const AUTO_LOCK_KEY = "ring.wallet.autolock";
/** The sealed wallet key for this tab. It opens only inside the vault worker, with a key that cannot be exported. */
const KEPT_KEY = "ring.wallet.kept";
const keep = (kept: Kept | null | undefined): void => {
  try {
    if (kept) sessionStorage.setItem(KEPT_KEY, JSON.stringify(kept));
    else sessionStorage.removeItem(KEPT_KEY);
  } catch {
    /* no session storage: a reload will ask for the password */
  }
};

interface Waiting {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (share: number) => void;
}
let worker: Worker | undefined;
let nextId = 0;
const waiting = new Map<number, Waiting>();
const lockListeners = new Set<(reason: "idle" | "asked") => void>();

function start(): Worker {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./vault.worker.ts", import.meta.url), { type: "module", name: "vault" });
  } catch {
    throw new Error("this browser cannot run the wallet's key vault. Try a current browser.");
  }
  worker.addEventListener("message", (event: MessageEvent<VaultEvent>) => {
    const message = event.data;
    if ("locked" in message) {
      keep(null);
      for (const listener of lockListeners) listener(message.locked);
      return;
    }
    const entry = waiting.get(message.id);
    if (!entry) return;
    if ("progress" in message) return entry.onProgress?.(message.progress);
    waiting.delete(message.id);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.error));
  });
  worker.addEventListener("error", () => {
    for (const entry of waiting.values()) entry.reject(new Error("the wallet's key vault stopped. Reload the page and unlock again."));
    waiting.clear();
  });
  void ask({ op: "autoLock", minutes: autoLockMinutes() });
  return worker;
}
function ask<Result>(request: VaultRequest, onProgress?: (share: number) => void): Promise<Result> {
  const target = start();
  const id = ++nextId;
  return new Promise<Result>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress });
    target.postMessage({ id, request });
  });
}

export function autoLockMinutes(): number {
  const stored = Number(typeof localStorage === "undefined" ? NaN : localStorage.getItem(AUTO_LOCK_KEY));
  return (AUTO_LOCK_CHOICES as readonly number[]).includes(stored) ? stored : 15;
}
export const vault = {
  async create(password: string, onProgress?: (share: number) => void): Promise<{ address: string; backup: Backup }> {
    const made = await ask<{ address: string; backup: Backup; kept: Kept | null }>({ op: "create", password }, onProgress);
    keep(made.kept);
    return made;
  },
  async unlock(backup: unknown, password: string, onProgress?: (share: number) => void): Promise<{ address: string }> {
    const opened = await ask<{ address: string; kept: Kept | null }>({ op: "unlock", backup, password }, onProgress);
    keep(opened.kept);
    return opened;
  },
  /** After a reload: opens the wallet again from this tab's sealed copy, if there is one and it is still good. */
  async resume(): Promise<{ address: string } | null> {
    let kept: Kept;
    try {
      kept = JSON.parse(sessionStorage.getItem(KEPT_KEY) ?? "null") as Kept;
    } catch {
      return null;
    }
    if (!kept || typeof kept.keyId !== "string") return null;
    const opened = await ask<{ address: string; kept: Kept | null } | null>({ op: "resume", kept }).catch(() => null);
    keep(opened?.kept);
    return opened;
  },
  lock: () => {
    keep(null);
    return ask<null>({ op: "lock" });
  },
  signMessage: (message: Uint8Array) => ask<Uint8Array>({ op: "signMessage", message }),
  signTransaction: (transaction: string, extraSeeds: Uint8Array[] = []) => ask<string>({ op: "signTransaction", transaction, extraSeeds }),
  noteKeys: () => ask<NoteKeys>({ op: "noteKeys" }),
  /** Tells the vault the person is still here, so it does not lock under their hands. */
  touch: () =>
    void ask<Kept | null>({ op: "touch" })
      .then((kept) => kept && keep(kept))
      .catch(() => undefined),
  async setAutoLock(minutes: number): Promise<void> {
    localStorage.setItem(AUTO_LOCK_KEY, String(minutes));
    const kept = await ask<Kept | null>({ op: "autoLock", minutes });
    if (kept) keep(kept);
  },
  onLocked(listener: (reason: "idle" | "asked") => void): () => void {
    lockListeners.add(listener);
    return () => lockListeners.delete(listener);
  },
};
