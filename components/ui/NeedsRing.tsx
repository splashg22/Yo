"use client";

import type { ReactNode } from "react";
import { useWallet } from "../wallet/WalletProvider";

/** True unless the server has said Ring balances are not connected on this network. */
export function useRingOn(): boolean {
  const { config } = useWallet();
  return !(config !== null && config !== "offline" && config.ring === "unavailable");
}

/** True only where the stand-in Ring is what runs. For the features built on it and not yet connected to the real program. */
export function useStandinOn(): boolean {
  const { config } = useWallet();
  return config !== null && config !== "offline" && config.ring === "mock";
}

/** Shows its contents where Ring balances exist; where they do not, says so plainly instead of offering forms that would fail. */
export function NeedsRing({
  children,
  instead,
  standinOnly,
}: {
  children: ReactNode;
  instead?: ReactNode;
  /** Set for a feature that exists only on the stand-in: what it is called, and why it is not on the real program yet. */
  standinOnly?: { what: string; why: string };
}) {
  const { config } = useWallet();
  const ringOn = useRingOn();
  // Until the server has said which it is, nothing that would call on a Ring balance is started.
  if (config === null) return <p className="body">Checking where this build runs.</p>;
  if (standinOnly && config !== "offline" && config.ring === "real")
    return (
      <>
        <p className="notice" data-not-connected>
          This build runs on the real Privacy Rings program here, and {standinOnly.what} is not connected to it yet. {standinOnly.why} Deposits, transfers and
          withdrawals are on the wallet page.
        </p>
        {instead}
      </>
    );
  if (ringOn) return <>{children}</>;
  return (
    <>
      <p className="notice">
        Ring balances are not connected on this network in this build. Launching, buying and selling coins work here. Holding and moving coins in a Ring does
        not yet.
      </p>
      {instead}
    </>
  );
}
