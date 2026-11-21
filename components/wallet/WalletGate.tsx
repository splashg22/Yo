"use client";

import { useState, type ReactNode } from "react";
import { useWallet } from "./WalletProvider";

/** Shown wherever a page needs a wallet and none is open: create, unlock, restore, or connect. */
export function WalletGate({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [file, setFile] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [visible, setVisible] = useState(false);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  if (wallet.signer) return <>{children}</>;

  // Turning the password into a key takes about a second. It runs in a worker, which reports how far along it is.
  const attempt = (task: () => void | Promise<void>) => {
    setBusy(true);
    setProblem("");
    setProgress(null);
    Promise.resolve()
      .then(task)
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        setBusy(false);
        setProgress(null);
      });
  };
  const creating = !wallet.hasBackup && !restoring;
  const submit = () => {
    if (restoring) return attempt(() => wallet.restore(file, password, setProgress));
    if (wallet.hasBackup) return attempt(() => wallet.unlock(password, setProgress));
    return attempt(() => {
      if (password !== again) throw new Error("the two passwords differ");
      return wallet.create(password, setProgress);
    });
  };

  return (
    <form
      className="gate"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2 className="h3">{restoring ? "Restore from a backup file" : wallet.hasBackup ? "Unlock your wallet" : "No wallet needed"}</h2>
      <p className="body">
        {restoring
          ? "Choose the backup file you saved and enter its password."
          : wallet.hasBackup
            ? "This browser holds a wallet, encrypted with your password."
            : "A wallet is made in this browser and encrypted with a password you choose. You get a deposit address to fund from any wallet or exchange. Only you hold the key: save the backup file and remember the password. Nobody can reset it."}
      </p>
      {restoring && (
        <div className="field">
          <label className="label" htmlFor="backup-file">
            Backup file
          </label>
          <input id="backup-file" type="file" accept="application/json,.json" onChange={(event) => void event.target.files?.[0]?.text().then(setFile)} />
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="wallet-password">
          Password, at least 8 characters
        </label>
        <input
          id="wallet-password"
          type={visible ? "text" : "password"}
          autoComplete={creating ? "new-password" : "current-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {creating && (
        <div className="field">
          <label className="label" htmlFor="wallet-password-again">
            Password again
          </label>
          <input
            id="wallet-password-again"
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            value={again}
            onChange={(event) => setAgain(event.target.value)}
          />
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />
        <span>Show the password as I type</span>
      </label>
      <div className="actions">
        <button className="btn" type="submit" disabled={busy || !password || (restoring && !file)}>
          {restoring ? "Restore" : wallet.hasBackup ? "Unlock" : "Create wallet"}
        </button>
        <button
          className="link"
          type="button"
          onClick={() => {
            setRestoring(!restoring);
            setProblem("");
          }}
        >
          {restoring ? "Back" : "Restore from a backup file"}
        </button>
      </div>
      {wallet.extensions.length > 0 && !restoring && (
        <div className="actions">
          <span className="label">Or connect</span>
          {wallet.extensions.map((extension) => (
            <button key={extension.name} className="link" type="button" disabled={busy} onClick={() => attempt(() => wallet.connect(extension))}>
              {extension.name}
            </button>
          ))}
        </div>
      )}
      <p className={`status-line ${problem ? "bad" : ""}`} role="status">
        {busy
          ? progress === null
            ? "Working"
            : `Unlocking, ${Math.round(progress * 100)}%`
          : problem || (wallet.lockedBecause === "idle" ? "The wallet locked itself after a while without use." : "")}
      </p>
    </form>
  );
}
