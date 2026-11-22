"use client";

/**
 * Wraps a page whose feature can be switched off. Where it is off, the page says so in one line and links onward;
 * nothing of the feature is drawn. A feature is off when it has only been built on a stand-in: see lib/server/env.ts.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { useWallet } from "./wallet/WalletProvider";

export function NotInBuild({ feature, name, children }: { feature: "otc" | "payLinks"; name: string; children: ReactNode }) {
  const { config } = useWallet();
  if (config === null) return null;
  if (config !== "offline" && !config.features[feature])
    return (
      <div className="app">
        <header className="app-head">
          <div>
            <h1 className="h3">{name} is not part of this build</h1>
          </div>
          <p>
            It has only been built against a stand-in for the Ring, and nothing simulated is shown here as live.{" "}
            <Link className="link" href="/wallet">
              Ring wallet
            </Link>{" "}
            <Link className="link" href="/terminal">
              Terminal
            </Link>
          </p>
        </header>
      </div>
    );
  return <>{children}</>;
}
