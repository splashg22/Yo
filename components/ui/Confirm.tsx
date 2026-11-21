import type { ReactNode } from "react";
import { PrivacyPanel } from "../PrivacyPanel";

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
  return (
    <div className="confirm">
      {children}
      {actions.map((action) => (
        <PrivacyPanel key={action} action={action} />
      ))}
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
