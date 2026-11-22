"use client";

/**
 * The wallet the app pages share. Two ways in:
 *  1. No wallet needed: a key made in this browser. It lives in a worker's memory while unlocked and as a
 *     password-encrypted backup at rest. It is never in the page, never in session or local storage unencrypted.
 *  2. A browser wallet, through the Wallet Standard.
 *
 * Either way one signature opens a short session with this site, so pages can refresh the wallet's own records
 * without asking it to sign again. Nothing on a timer ever opens a wallet prompt.
 */
import { followRecording } from "@/lib/client/clock";
import { utf8 } from "@/lib/bytes";
import { noteKeyMessage, noteKeysFor, type NoteKeys } from "@/lib/notes";
import { getWallets } from "@wallet-standard/app";
import type { Wallet as StandardWallet, WalletAccount } from "@wallet-standard/base";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode, useRef } from "react";
import type { Backup } from "@/lib/backup";
import { fromBase64, toBase64 } from "@/lib/bytes";
import { SessionEnded, api, signedApi, type Signer } from "@/lib/client/api";
import { vault } from "@/lib/client/vault";
import type { Config } from "@/lib/contract";
import { signTransaction } from "@/lib/sign";

const BACKUP_KEY = "ring.wallet.backup"; // the encrypted key: safe at rest
/** Left by earlier builds, which kept the unlocked key here for the life of the tab. Removed on sight. */
const OLD_SESSION_KEY = "ring.wallet.session";

export interface WalletState {
  signer: Signer | null;
  /** Null until the server has answered; "offline" if it could not be reached. */
  config: Config | "offline" | null;
  hasBackup: boolean;
  /** Why the wallet is locked, when it locked itself. */
  lockedBecause: "idle" | null;
  /** True when a connected browser wallet's session has ended and it must sign in again to refresh its records. */
  sessionEnded: boolean;
  signIn: () => Promise<void>;
  extensions: StandardWallet[];
  /** Each takes a moment (the password is turned into a key in a worker); `onProgress` is called with a share from 0 to 1. */
  create: (password: string, onProgress?: (share: number) => void) => Promise<void>;
  unlock: (password: string, onProgress?: (share: number) => void) => Promise<void>;
  restore: (file: string, password: string, onProgress?: (share: number) => void) => Promise<void>;
  connect: (wallet: StandardWallet) => Promise<void>;
  lock: () => void;
  backupFile: () => string | null;
}
const Context = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const value = useContext(Context);
  if (!value) throw new Error("useWallet needs <WalletProvider>");
  return value;
}

/** A session, opened when first needed and reopened when it is close to ending. `mayAsk` says whether opening one may prompt the person. */
function sessionKeeper(address: string, sign: (message: Uint8Array) => Promise<Uint8Array>, silent: boolean, onEnded: (ended: boolean) => void) {
  let current: { token: string; expiresAt: number } | undefined;
  let opening: Promise<string> | undefined;
  return ({ ask = true }: { ask?: boolean } = {}): Promise<string> => {
    if (current && current.expiresAt - Date.now() > 30_000) return Promise.resolve(current.token);
    // A wallet in this browser signs without a prompt, so its session renews itself. An extension is only asked when the person acted.
    if (!silent && !ask) {
      onEnded(true);
      return Promise.reject(new SessionEnded());
    }
    opening ??= signedApi("session/open", {
      kind: "browser",
      label: "",
      address,
      signMessage: sign,
      signTransaction: () => Promise.reject(new Error("unused")),
      session: () => Promise.reject(new Error("unused")),
    })
      .then((opened) => {
        current = opened;
        onEnded(false);
        return opened.token;
      })
      .finally(() => (opening = undefined));
    return opening;
  };
}

interface StandardFeatures {
  "standard:connect": { connect(): Promise<{ accounts: readonly WalletAccount[] }> };
  "solana:signMessage": { signMessage(input: { account: WalletAccount; message: Uint8Array }): Promise<readonly { signature: Uint8Array }[]> };
  "solana:signTransaction": {
    signTransaction(input: { account: WalletAccount; transaction: Uint8Array }): Promise<readonly { signedTransaction: Uint8Array }[]>;
  };
}
const NEEDED_FEATURES = ["standard:connect", "solana:signMessage", "solana:signTransaction"];

function vaultSigner(address: string, onEnded: (ended: boolean) => void): Signer {
  const signMessage = (message: Uint8Array) => vault.signMessage(message);
  return {
    kind: "browser",
    label: "This browser",
    address,
    signMessage,
    signTransaction: (transaction, extraSeeds = []) => vault.signTransaction(transaction, extraSeeds),
    noteKeys: () => vault.noteKeys(),
    session: sessionKeeper(address, signMessage, true, onEnded),
  };
}

async function extensionSigner(wallet: StandardWallet, onEnded: (ended: boolean) => void): Promise<Signer> {
  const features = wallet.features as unknown as StandardFeatures;
  const account = (await features["standard:connect"].connect()).accounts[0];
  if (!account) throw new Error(`${wallet.name} did not share an account`);
  /** A wallet says no in its own words, or in none. Either way the person is told the one thing that matters: nothing was sent. */
  const asked = async <Result,>(request: Promise<readonly Result[]>): Promise<[Result]> => {
    let first: Result | undefined;
    try {
      [first] = await request;
    } catch {
      throw new Error(`${wallet.name} did not sign: the request was declined or the wallet is locked. Nothing was sent.`);
    }
    if (first === undefined) throw new Error(`${wallet.name} did not sign. Nothing was sent.`);
    return [first];
  };
  const signMessage = async (message: Uint8Array): Promise<Uint8Array> => {
    const [result] = await asked(features["solana:signMessage"].signMessage({ account, message }));
    return result.signature;
  };
  // One extra signature when connecting: a fixed message whose signature seeds the wallet's note key. An Ed25519
  // signature of the same message is the same every time, so reconnecting gives the same key and old notes still open.
  // It is asked for once per page load and kept in memory only.
  let notes: Promise<NoteKeys> | undefined;
  const noteKeys = (): Promise<NoteKeys> => (notes ??= signMessage(utf8(noteKeyMessage(window.location.host))).then((signature) => noteKeysFor(signature)));
  return {
    kind: "extension",
    label: wallet.name,
    address: account.address,
    noteKeys,
    signMessage,
    signTransaction: async (transaction, extraSeeds = []) => {
      // Keys made for this transaction sign first; the wallet signs last.
      const prepared = extraSeeds.length > 0 ? signTransaction(transaction, extraSeeds) : transaction;
      const [result] = await asked(features["solana:signTransaction"].signTransaction({ account, transaction: fromBase64(prepared) }));
      return toBase64(result.signedTransaction);
    },
    session: sessionKeeper(account.address, signMessage, false, onEnded),
  };
}

export function WalletProvider({ children, initialConfig = null }: { children: ReactNode; initialConfig?: Config | null }) {
  const [signer, setSigner] = useState<Signer | null>(null);
  // `initialConfig` is what the server rendered the page with; without it the page asks.
  const [config, setConfig] = useState<Config | "offline" | null>(() => {
    // A server playing back a recording: this page's clock follows the recording's from its first draw.
    followRecording(initialConfig?.recording);
    return initialConfig;
  });
  const [hasBackup, setHasBackup] = useState(false);
  const [extensions, setExtensions] = useState<StandardWallet[]>([]);
  const [lockedBecause, setLockedBecause] = useState<"idle" | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);

  // Asked once; the wallet's registration waits for the answer, so it is not attempted where there is no Ring to register with.
  const settings = useRef<Promise<Config | "offline"> | undefined>(initialConfig ? Promise.resolve(initialConfig) : undefined);
  const settingsOnce = useCallback(() => (settings.current ??= api("config").catch(() => "offline" as const)), []);

  const open = useCallback(
    (next: Signer) => {
      setSigner(next);
      setLockedBecause(null);
      setSessionEnded(false);
      // Sign in now, while the person is here: for a browser wallet this is its one prompt for the session.
      void next.session().catch(() => undefined);
      // A wallet publishes its Ring keys once, so that it can receive transfers. If this
      // fails the wallet still works; a transfer to it reports "not registered" until it succeeds.
      // With it goes the wallet's public note key, so that others can seal notes to it.
      // A wallet that declines the note-key signature is still registered, without a note key: it can hold and move coins, not notes.
      void settingsOnce().then((known) => {
        if (known === "offline" || known.ring !== "mock") return;
        Promise.resolve(next.noteKeys?.())
          .catch(() => undefined)
          .then((keys) => signedApi("ring/register", next, keys ? { noteKey: toBase64(keys.publicKey) } : {}))
          .catch((error: unknown) => console.warn("Ring registration did not complete:", error));
      });
    },
    [settingsOnce],
  );

  useEffect(() => {
    void settingsOnce().then(setConfig);
    setHasBackup(localStorage.getItem(BACKUP_KEY) !== null);
    sessionStorage.removeItem(OLD_SESSION_KEY);
    // After a reload in the same tab the vault can open the wallet again without the password, if it has not been idle too long.
    void vault.resume().then((resumed) => resumed && open(vaultSigner(resumed.address, setSessionEnded)));
    const discover = () =>
      setExtensions(
        getWallets()
          .get()
          .filter((wallet) => NEEDED_FEATURES.every((feature) => feature in wallet.features)),
      );
    discover();
    const timer = setTimeout(discover, 800); // extensions announce themselves shortly after load
    // The vault locks itself when left alone. The page then shows the unlock form again.
    const stopListening = vault.onLocked((reason) => {
      setSigner((current) => (current?.kind === "browser" ? null : current));
      setLockedBecause(reason === "idle" ? "idle" : null);
    });
    // Using the page counts as using the wallet: the vault is told, at most twice a minute.
    let told = 0;
    const active = () => {
      if (Date.now() - told < 30_000) return;
      told = Date.now();
      vault.touch();
    };
    for (const kind of ["pointerdown", "keydown"] as const) window.addEventListener(kind, active, { passive: true });
    return () => {
      clearTimeout(timer);
      stopListening();
      for (const kind of ["pointerdown", "keydown"] as const) window.removeEventListener(kind, active);
    };
  }, [settingsOnce, open]);

  const adopt = useCallback(
    (address: string, backup: Backup) => {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
      setHasBackup(true);
      open(vaultSigner(address, setSessionEnded));
    },
    [open],
  );

  const value = useMemo<WalletState>(
    () => ({
      signer,
      config,
      hasBackup,
      lockedBecause,
      sessionEnded,
      signIn: async () => {
        await signer?.session({ ask: true });
      },
      extensions,
      create: async (password, onProgress) => {
        if (password.length < 8) throw new Error("the password must be at least 8 characters");
        const made = await vault.create(password, onProgress);
        adopt(made.address, made.backup);
      },
      unlock: async (password, onProgress) => {
        const stored = localStorage.getItem(BACKUP_KEY);
        if (!stored) throw new Error("there is no wallet in this browser");
        let backup: Backup;
        try {
          backup = JSON.parse(stored) as Backup;
        } catch {
          throw new Error("the wallet stored in this browser is damaged. Restore it from your backup file.");
        }
        adopt((await vault.unlock(backup, password, onProgress)).address, backup);
      },
      restore: async (file, password, onProgress) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(file);
        } catch {
          throw new Error("that is not a backup file");
        }
        adopt((await vault.unlock(parsed, password, onProgress)).address, parsed as Backup);
      },
      connect: async (wallet) => open(await extensionSigner(wallet, setSessionEnded)),
      lock: () => {
        void vault.lock();
        setSigner(null);
      },
      backupFile: () => localStorage.getItem(BACKUP_KEY),
    }),
    [signer, config, hasBackup, lockedBecause, sessionEnded, extensions, adopt, open],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
