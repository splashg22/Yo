"use client";

import type { ReactNode } from "react";
import { useWallet } from "../wallet/WalletProvider";

/**
 * The frame every app page shares: its name, a title, and one line saying what the page is for.
 * The line is one line on purpose. What an action makes public is said in full in the panel beside the
 * action, on the docs page and on the status page; the header does not repeat it.
 */
export function AppPage({ label, title, intro, children }: { label: string; title: string; intro: string; children: ReactNode }) {
  const { config } = useWallet();
  return (
    <div className="app">
      <header className="app-head">
        <div>
          <span className="label">{label}</span>
          <h1 className="h3">{title}</h1>
        </div>
        <p>{intro}</p>
      </header>
      {config === "offline" ? (
        <p className="notice" role="alert">
          This site&apos;s server is not answering, so nothing here can be loaded or sent. Check your connection and reload.
        </p>
      ) : (
        children
      )}
    </div>
  );
}
