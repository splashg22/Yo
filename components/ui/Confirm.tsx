"use client";

import type { ReactNode } from "react";
import { feeText } from "@/lib/fee-text";
import { PrivacyPanel } from "../PrivacyPanel";
import { useWallet } from "../wallet/WalletProvider";

/** The step before every signature: what this action will make public and what it will encrypt, then the button that signs. */
export function Confirm({
  actions,
  label,
  onConfirm,
  onCancel,
  busy,
  children,
}: {
  actions: string[];
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  children?: ReactNode;
}) {
  const { config } = useWallet();
  const fees = config && config !== "offline" ? config.fees : null;
  return (
    <div className="confirm">
      {children}
      {actions.map((action) => {
        const fee = fees ? feeText(action, fees) : "";
        return (
          <div key={action} style={{ display: "grid", gap: 8 }}>
            <PrivacyPanel action={action} realRing={config !== null && config !== "offline" && config.ring === "real"} />
            {fee && (
              <p className="note-line" data-fee>
                {fee}
              </p>
            )}
          </div>
        );
      })}
      <div className="actions">
        <button className="btn" type="button" onClick={onConfirm} disabled={busy}>
          {busy ? "Working" : label}
        </button>
        <button className="link" type="button" onClick={onCancel} disabled={busy}>
          Back
        </button>
      </div>
    </div>
  );
}
