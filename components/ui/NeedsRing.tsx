"use client";

import type { ReactNode } from "react";
import { useWallet } from "../wallet/WalletProvider";

/** True unless the server has said Ring balances are not connected on this network. */
export function useRingOn(): boolean {
  const { config } = useWallet();
  return !(config !== null && config !== "offline" && config.ring === "unavailable");
}

/** Shows its contents where Ring balances exist; where they do not, says so plainly instead of offering forms that would fail. */
export function NeedsRing({ children, instead }: { children: ReactNode; instead?: ReactNode }) {
  const { config } = useWallet();
  const ringOn = useRingOn();
  // Until the server has said which it is, nothing that would call on a Ring balance is started.
  if (config === null) return <p className="body">Checking where this build runs.</p>;
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
