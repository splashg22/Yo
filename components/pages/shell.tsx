"use client";

import type { ReactNode } from "react";
import { useWallet } from "../Wallet";

/** The frame every app page shares: a label, a title, a line of explanation, and where this build runs. */
export function AppPage({ label, title, intro, children }: { label: string; title: string; intro: string; children: ReactNode }) {
  const { config } = useWallet();
  return (
    <div className="page">
      <div className="wrap">
        <span className="label">{label}</span>
        <h1 className="h2">{title}</h1>
        <p className="body">{intro}</p>
        {config?.ring === "mock" && (
          <p className="mock-note">
            Local test chain. Launches and trades run on a copy of the real pump.fun program. Ring balances on this chain are kept
            by a local stand-in that follows the same rules for what is public and what is encrypted. Coins here have no value.
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
