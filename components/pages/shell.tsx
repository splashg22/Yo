"use client";

import type { ReactNode } from "react";
import { useWallet } from "../wallet/WalletProvider";

/** The frame every app page shares: a label, a title, a line of explanation, and a plain statement of where this build runs. */
export function AppPage({ label, title, intro, children }: { label: string; title: string; intro: string; children: ReactNode }) {
  const { config } = useWallet();
  return (
    <div className="page">
      <div className="wrap">
        <span className="label">{label}</span>
        <h1 className="h2">{title}</h1>
        <p className="body">{intro}</p>
        {config === "offline" ? (
          <p className="notice" role="alert">
            This site&apos;s server is not answering, so nothing here can be loaded or sent. Check your connection and reload.
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
