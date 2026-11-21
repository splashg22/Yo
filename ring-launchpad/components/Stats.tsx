"use client";

import { useEffect, useState } from "react";

interface Stats {
  network: string;
  available: boolean;
  reason?: string;
  launched?: number;
  registered?: number;
  supplyInRings?: string;
  depositors?: number;
}
const LABELS: [keyof Stats, string][] = [
  ["launched", "Coins launched"],
  ["registered", "Registered with a Ring"],
  ["supplyInRings", "Supply held in Rings"],
  ["depositors", "Wallets that deposited"],
];

export function StatsRow() {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => setStats({ network: "devnet", available: false, reason: "The counters could not be read." }));
  }, []);
  return (
    <>
      <div className="stats">
        {LABELS.map(([key, label]) => (
          <div key={key}>
            {/* A number appears only when it was read from the chain. There is no fallback figure. */}
            {stats?.available && stats[key] !== undefined && <b className="num">{String(stats[key])}</b>}
            <span className="label">{label}</span>
          </div>
        ))}
      </div>
      <p className="label">
        {stats === null ? "Reading the chain." : stats.available ? `Read from ${stats.network}.` : `Read from ${stats.network}. ${stats.reason}`}
      </p>
    </>
  );
}
