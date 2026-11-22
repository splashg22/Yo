"use client";

/** The line at the foot of the trading screens: whether the live connection is up, how quick it is, and what SOL is worth. */
import { useEffect, useState } from "react";
import { onLiveStatus, type LiveStatus } from "@/lib/client/live";
import { formatUsd } from "@/lib/format";
import { Time, useSolPrice } from "../ui/Money";

const TEXT: Record<LiveStatus, string> = { live: "Live", connecting: "Connecting", offline: "Offline: figures are not updating" };

export function LiveStrip({ onHelp }: { onHelp?: () => void }) {
  const [state, setState] = useState<{ status: LiveStatus; latencyMs: number | null; staleMs: number }>({ status: "connecting", latencyMs: null, staleMs: 0 });
  useEffect(() => onLiveStatus((status, latencyMs, staleMs) => setState({ status, latencyMs, staleMs })), []);
  // Connected, but the server itself is behind the chain: the figures on screen are old, and a trade would be priced on them.
  const behind = state.status === "live" && state.staleMs > 3000;
  const price = useSolPrice();
  return (
    <div className="statusbar" role="status" data-live={behind ? "stale" : state.status}>
      <span>
        <span className={`dot${state.status === "live" && !behind ? "" : " off"}`} aria-hidden="true" />
        {behind ? "Live data paused" : TEXT[state.status]}
        {state.status === "live" && !behind && state.latencyMs !== null && ` ${state.latencyMs} ms`}
      </span>
      {behind && (
        <span data-stale>
          The server last read the chain {Math.round(state.staleMs / 1000)} seconds ago. Prices here are that old; a trade is still checked against the chain
          when it is built.
        </span>
      )}
      {price ? (
        <span title={price.source}>
          SOL {formatUsd(price.usd)}, as of <Time at={price.at} /> ago
        </span>
      ) : (
        <span>No dollar price here: figures are in SOL</span>
      )}
      {onHelp && (
        <button className="link desk-only" type="button" onClick={onHelp} style={{ marginLeft: "auto" }}>
          Keys <kbd>?</kbd>
        </button>
      )}
    </div>
  );
}
