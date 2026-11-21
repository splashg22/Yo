"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Activity } from "@/lib/contract";
import { formatTime, shortAddress } from "@/lib/format";

/**
 * The latest public transactions for one address, as the chain lists them. Refreshed on a
 * timer and whenever `version` changes, which a page bumps after an action of its own.
 */
export function ActivityList({ load, empty, version = 0 }: { load: () => Promise<{ activity: Activity[] }>; empty: string; version?: string | number }) {
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [problem, setProblem] = useState("");
  const refresh = useCallback(async () => {
    try {
      setActivity((await load()).activity);
      setProblem("");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, [load]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 10_000);
    return () => clearInterval(timer);
  }, [refresh, version]);
  return (
    <>
      {problem && (
        <p className="notice" role="alert">
          This list could not be read: {problem}{" "}
          <button className="link" type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </p>
      )}
      <ul className="events">
        {activity === null && !problem && <li className="pub">Reading the chain.</li>}
        {activity?.length === 0 && <li className="pub">{empty}</li>}
        {activity?.map((entry) => (
          <li key={entry.signature}>
            <b className="address">{shortAddress(entry.signature)}</b>
            <span className="label">{entry.blockTime === undefined ? "Time not recorded" : formatTime(entry.blockTime * 1000)}</span>
            <span className="pub">{entry.failed ? "Failed on-chain. Nothing moved except the network fee." : "Confirmed."}</span>
            <Link className="link" href={`/tx/${entry.signature}`}>
              Receipt
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
