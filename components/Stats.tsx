"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { Stats } from "@/lib/contract";

type Countable = "launched" | "registered" | "depositors";
const LABELS: [Countable, string][] = [
  ["launched", "Coins launched"],
  ["registered", "Registered with a Ring"],
  ["depositors", "Wallets that deposited a coin"],
];

export function StatsRow() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    api("stats").then(setStats, (error: unknown) => setProblem(error instanceof Error ? error.message : String(error)));
  }, []);
  return (
    <>
      <div className="stats">
        {LABELS.map(([key, label]) => (
          <div key={key}>
            {/* A number appears only when it was read from the chain. There is no fallback figure: until then the
                line is empty, but keeps its height so the page below does not jump when the numbers arrive. */}
            <b className="num">{stats?.available && stats[key] !== undefined ? String(stats[key]) : "\u00a0"}</b>
            <span className="label">{label}</span>
          </div>
        ))}
      </div>
      <p className="label stats-note">
        {problem
          ? `The counters could not be read: ${problem}`
          : stats === null
            ? "Reading the chain."
            : `Read from ${stats.network === "local" ? "the local test chain" : stats.network === "mainnet" ? "Solana mainnet (read only)" : "devnet"} just now.${stats.reason ? ` ${stats.reason}` : ""}`}
      </p>
    </>
  );
}
