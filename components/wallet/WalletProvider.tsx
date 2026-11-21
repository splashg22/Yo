"use client";

/**
 * The wallet the app pages share. Two ways in:
 *  1. No wallet needed: a key made in this browser, kept as a password-encrypted backup.
 *  2. A browser wallet, through the Wallet Standard.
 */
import { utf8 } from "@/lib/bytes";
import { NOTE_KEY_MESSAGE, noteKeysFor, type NoteKeys } from "@/lib/notes";
import { getWallets } from "@wallet-standard/app";
import type { Wallet as StandardWallet, WalletAccount } from "@wallet-standard/base";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { decryptBackup, encryptBackup, type Backup } from "@/lib/backup";
import { fromBase64, toBase64 } from "@/lib/bytes";
import { api, signedApi, type Signer } from "@/lib/client/api";
import type { Config } from "@/lib/contract";
import { actorFromSeed, newActor, signMessage, type Actor } from "@/lib/keys";
import { signTransaction } from "@/lib/sign";

const BACKUP_KEY = "ring.wallet.backup"; // the encrypted key: safe at rest
const SESSION_KEY = "ring.wallet.session"; // the unlocked key, for this tab only; gone when the tab closes

export interface WalletState {
  signer: Signer | null;
  /** Null until the server has answered; "offline" if it could not be reached. */
  config: Config | "offline" | null;
  hasBackup: boolean;
  extensions: StandardWallet[];
  create: (password: string) => void;
  unlock: (password: string) => void;
  restore: (file: string, password: string) => void;
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

function browserSigner(actor: Actor): Signer {
  return {
    kind: "browser",
    label: "This browser",
    address: actor.address,
    signMessage: (message) => Promise.resolve(signMessage(actor, message)),
    signTransaction: (transaction, extraSeeds = []) => Promise.resolve(signTransaction(transaction, [actor.seed, ...extraSeeds])),
    noteKeys: () => noteKeysFor(actor.seed),
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

async function extensionSigner(wallet: StandardWallet): Promise<Signer> {
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
  // One extra signature when connecting: a fixed message whose signature seeds the wallet's note key. An Ed25519
  // signature of the same message is the same every time, so reconnecting gives the same key and old notes still open.
  // It is asked for once per page load and kept in memory only.
  let notes: Promise<NoteKeys> | undefined;
  const noteKeys = (): Promise<NoteKeys> =>
    (notes ??= asked(features["solana:signMessage"].signMessage({ account, message: utf8(NOTE_KEY_MESSAGE) })).then(([result]) =>
      noteKeysFor(result.signature),
    ));
  return {
    kind: "extension",
    label: wallet.name,
    address: account.address,
    noteKeys,
    signMessage: async (message) => {
      const [result] = await asked(features["solana:signMessage"].signMessage({ account, message }));
      return result.signature;
    },
    signTransaction: async (transaction, extraSeeds = []) => {
      // Keys made for this transaction sign first; the wallet signs last.
      const prepared = extraSeeds.length > 0 ? signTransaction(transaction, extraSeeds) : transaction;
      const [result] = await asked(features["solana:signTransaction"].signTransaction({ account, transaction: fromBase64(prepared) }));
      return toBase64(result.signedTransaction);
    },
  };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [config, setConfig] = useState<Config | "offline" | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  const [extensions, setExtensions] = useState<StandardWallet[]>([]);

  const open = useCallback((next: Signer) => {
    setSigner(next);
    // A wallet publishes its Ring keys once, so that it can receive transfers. If this
    // fails the wallet still works; a transfer to it reports "not registered" until it succeeds.
    // With it goes the wallet's public note key, so that others can seal notes to it.
    // A wallet that declines the note-key signature is still registered, without a note key: it can hold and move coins, not notes.
    Promise.resolve(next.noteKeys?.())
      .catch(() => undefined)
      .then((keys) => signedApi("ring/register", next, keys ? { noteKey: toBase64(keys.publicKey) } : {}))
      .catch((error: unknown) => console.warn("Ring registration did not complete:", error));
  }, []);

  useEffect(() => {
    api("config").then(setConfig, () => setConfig("offline"));
    setHasBackup(localStorage.getItem(BACKUP_KEY) !== null);
    const session = sessionStorage.getItem(SESSION_KEY);
    if (session) {
      try {
        open(browserSigner(actorFromSeed(fromBase64(session))));
      } catch {
        sessionStorage.removeItem(SESSION_KEY); // unreadable: fall back to asking for the password
      }
    }
    const discover = () =>
      setExtensions(
        getWallets()
          .get()
          .filter((wallet) => NEEDED_FEATURES.every((feature) => feature in wallet.features)),
      );
    discover();
    const timer = setTimeout(discover, 800); // extensions announce themselves shortly after load
    return () => clearTimeout(timer);
  }, [open]);

  const adopt = useCallback(
    (actor: Actor, backup: Backup) => {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
      sessionStorage.setItem(SESSION_KEY, toBase64(actor.seed));
      setHasBackup(true);
      open(browserSigner(actor));
    },
    [open],
  );

  const value = useMemo<WalletState>(
    () => ({
      signer,
      config,
      hasBackup,
      extensions,
      create: (password) => {
        const actor = newActor();
        adopt(actor, encryptBackup(actor, password));
      },
      unlock: (password) => {
        const stored = localStorage.getItem(BACKUP_KEY);
        if (!stored) throw new Error("there is no wallet in this browser");
        let backup: Backup;
        try {
          backup = JSON.parse(stored) as Backup;
        } catch {
          throw new Error("the wallet stored in this browser is damaged. Restore it from your backup file.");
        }
        adopt(decryptBackup(backup, password), backup);
      },
      restore: (file, password) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(file);
        } catch {
          throw new Error("that is not a backup file");
        }
        adopt(decryptBackup(parsed, password), parsed as Backup);
      },
      connect: async (wallet) => open(await extensionSigner(wallet)),
      lock: () => {
        sessionStorage.removeItem(SESSION_KEY);
        setSigner(null);
      },
      backupFile: () => localStorage.getItem(BACKUP_KEY),
    }),
    [signer, config, hasBackup, extensions, adopt, open],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
