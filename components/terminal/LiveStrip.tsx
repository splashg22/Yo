"use client";

/** The line at the foot of the trading screens: whether the live connection is up, how quick it is, and what SOL is worth. */
import { useEffect, useState } from "react";
import { onLiveStatus, type LiveStatus } from "@/lib/client/live";
import { formatUsd } from "@/lib/format";
import { Time, useSolPrice } from "../ui/Money";

const TEXT: Record<LiveStatus, string> = { live: "Live", connecting: "Connecting", offline: "Offline: figures are not updating" };

export function LiveStrip({ onHelp }: { onHelp?: () => void }) {
  const [state, setState] = useState<{ status: LiveStatus; latencyMs: number | null }>({ status: "connecting", latencyMs: null });
  useEffect(() => onLiveStatus((status, latencyMs) => setState({ status, latencyMs })), []);
  const price = useSolPrice();
  return (
    <div className="statusbar" role="status" data-live={state.status}>
      <span>
        <span className={`dot${state.status === "live" ? "" : " off"}`} aria-hidden="true" />
        {TEXT[state.status]}
        {state.status === "live" && state.latencyMs !== null && ` ${state.latencyMs} ms`}
      </span>
      {price ? (
        <span title={price.source}>
          SOL {formatUsd(price.usd)}, as of <Time at={price.at} /> ago
        </span>
      ) : (
        <span>No dollar price here: figures are in SOL</span>
      )}
      {onHelp && (
        <button className="link" type="button" onClick={onHelp} style={{ marginLeft: "auto" }}>
          Keys <kbd>?</kbd>
        </button>
      )}
    </div>
  );
}
