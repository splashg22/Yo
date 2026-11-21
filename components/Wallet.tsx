"use client";

/**
 * The wallet the app pages share. Two ways in:
 *  1. No wallet needed: a key made in this browser, kept as a password-encrypted backup.
 *  2. A browser wallet, through the Wallet Standard.
 */
import { getWallets } from "@wallet-standard/app";
import type { Wallet as StandardWallet, WalletAccount } from "@wallet-standard/base";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { decryptBackup, encryptBackup, type Backup } from "@/lib/backup";
import { fromBase64, toBase64 } from "@/lib/bytes";
import { api, signedApi, type Signer } from "@/lib/client/api";
import { actorFromSeed, newActor, signMessage, type Actor } from "@/lib/keys";
import { signTransaction } from "@/lib/sign";

const BACKUP_KEY = "ring.wallet.backup"; // the encrypted key: safe at rest
const SESSION_KEY = "ring.wallet.session"; // the unlocked key, for this tab only; gone when the tab closes

interface Config { network: string; ring: string; native: string; decimals: number }
interface WalletState {
  signer: Signer | null;
  config: Config | null;
  hasBackup: boolean;
  extensions: StandardWallet[];
  create(password: string): Promise<void>;
  unlock(password: string): Promise<void>;
  restore(file: string, password: string): Promise<void>;
  connect(wallet: StandardWallet): Promise<void>;
  lock(): void;
  backupFile(): string | null;
}
const Context = createContext<WalletState | null>(null);
export const useWallet = () => {
  const value = useContext(Context);
  if (!value) throw new Error("useWallet needs <WalletProvider>");
  return value;
};

function browserSigner(actor: Actor): Signer {
  return {
    kind: "browser", label: "This browser", address: actor.address,
    signMessage: async (message) => signMessage(actor, message),
    signTransaction: async (transaction, extraSeeds = []) => signTransaction(transaction, [actor.seed, ...extraSeeds]),
  };
}
interface Features {
  "standard:connect": { connect(): Promise<{ accounts: readonly WalletAccount[] }> };
  "solana:signMessage": { signMessage(i: { account: WalletAccount; message: Uint8Array }): Promise<readonly { signature: Uint8Array }[]> };
  "solana:signTransaction": { signTransaction(i: { account: WalletAccount; transaction: Uint8Array }): Promise<readonly { signedTransaction: Uint8Array }[]> };
}
const NEEDED = ["standard:connect", "solana:signMessage", "solana:signTransaction"];

export function WalletProvider({ children }: { children: ReactNode }) {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  const [extensions, setExtensions] = useState<StandardWallet[]>([]);

  const open = useCallback((next: Signer) => {
    setSigner(next);
    // A wallet publishes its Ring keys once, so that it can receive transfers. Public.
    signedApi("ring/register", next).catch(() => undefined);
  }, []);

  useEffect(() => {
    api<Config>("config").then(setConfig).catch(() => undefined);
    setHasBackup(Boolean(localStorage.getItem(BACKUP_KEY)));
    const session = sessionStorage.getItem(SESSION_KEY);
    if (session) { try { open(browserSigner(actorFromSeed(fromBase64(session)))); } catch { sessionStorage.removeItem(SESSION_KEY); } }
    const found = () => setExtensions(getWallets().get().filter((w) => NEEDED.every((f) => f in w.features)));
    found();
    const timer = setTimeout(found, 800);
    return () => clearTimeout(timer);
  }, [open]);

  const adopt = useCallback((actor: Actor, backup: Backup) => {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
    sessionStorage.setItem(SESSION_KEY, toBase64(actor.seed));
    setHasBackup(true);
    open(browserSigner(actor));
  }, [open]);

  const value = useMemo<WalletState>(() => ({
    signer, config, hasBackup, extensions,
    create: async (password) => { const actor = newActor(); adopt(actor, encryptBackup(actor, password)); },
    unlock: async (password) => {
      const stored = localStorage.getItem(BACKUP_KEY);
      if (!stored) throw new Error("there is no wallet in this browser");
      const backup = JSON.parse(stored) as Backup;
      adopt(decryptBackup(backup, password), backup);
    },
    restore: async (file, password) => {
      let parsed: unknown;
      try { parsed = JSON.parse(file); } catch { throw new Error("that is not a backup file"); }
      adopt(decryptBackup(parsed, password), parsed as Backup);
    },
    connect: async (wallet) => {
      const features = wallet.features as unknown as Features;
      const account = (await features["standard:connect"].connect()).accounts[0];
      if (!account) throw new Error(`${wallet.name} did not share an account`);
      open({
        kind: "extension", label: wallet.name, address: account.address,
        signMessage: async (message) => (await features["solana:signMessage"].signMessage({ account, message }))[0]!.signature,
        signTransaction: async (transaction, extraSeeds = []) => {
          // Keys made for this transaction sign first; the wallet signs last.
          const tx = VersionedTransaction.deserialize(fromBase64(transaction));
          if (extraSeeds.length) tx.sign(extraSeeds.map((seed) => Keypair.fromSeed(seed)));
          const [result] = await features["solana:signTransaction"].signTransaction({ account, transaction: tx.serialize() });
          return toBase64(result!.signedTransaction);
        },
      });
    },
    lock: () => { sessionStorage.removeItem(SESSION_KEY); setSigner(null); },
    backupFile: () => localStorage.getItem(BACKUP_KEY),
  }), [signer, config, hasBackup, extensions, adopt, open]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Shown wherever a page needs a wallet and none is open. */
export function WalletGate({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [file, setFile] = useState("");
  const [mode, setMode] = useState<"main" | "restore">("main");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (wallet.signer) return <>{children}</>;

  const attempt = (task: () => Promise<void>) => {
    setBusy(true); setError("");
    // Deriving the key from the password takes a moment; let the button show it first.
    setTimeout(() => task().catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false)), 30);
  };
  const creating = !wallet.hasBackup && mode === "main";

  return (
    <div className="gate">
      <h2 className="h3">{mode === "restore" ? "Restore from a backup file" : wallet.hasBackup ? "Unlock your wallet" : "No wallet needed"}</h2>
      <p className="body">
        {mode === "restore" ? "Choose the backup file you saved and enter its password."
          : wallet.hasBackup ? "This browser holds a wallet, encrypted with your password."
          : "A wallet is made in this browser and encrypted with a password you choose. You get a deposit address to fund from any wallet or exchange. Only you hold the key: keep the backup file and the password."}
      </p>
      {mode === "restore" && (
        <div className="field">
          <label className="label" htmlFor="backup-file">Backup file</label>
          <input id="backup-file" type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0]?.text().then(setFile)} />
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="wallet-password">Password, at least 8 characters</label>
        <input id="wallet-password" type="password" autoComplete={creating ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {creating && (
        <div className="field">
          <label className="label" htmlFor="wallet-password-again">Password again</label>
          <input id="wallet-password-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </div>
      )}
      <div className="actions">
        {mode === "restore" ? (
          <button className="btn" disabled={busy || !file || !password} onClick={() => attempt(() => wallet.restore(file, password))}>Restore</button>
        ) : wallet.hasBackup ? (
          <button className="btn" disabled={busy || !password} onClick={() => attempt(() => wallet.unlock(password))}>Unlock</button>
        ) : (
          <button className="btn" disabled={busy || !password} onClick={() => attempt(async () => { if (password !== again) throw new Error("the two passwords differ"); await wallet.create(password); })}>Create wallet</button>
        )}
        <button className="link" onClick={() => { setMode(mode === "restore" ? "main" : "restore"); setError(""); }}>{mode === "restore" ? "Back" : "Restore from a backup file"}</button>
      </div>
      {wallet.extensions.length > 0 && mode === "main" && (
        <div className="actions">
          <span className="label">Or connect</span>
          {wallet.extensions.map((w) => <button key={w.name} className="link" onClick={() => attempt(() => wallet.connect(w))}>{w.name}</button>)}
        </div>
      )}
      <p className="status-line bad" role="alert">{busy ? "Working…" : error}</p>
    </div>
  );
}
