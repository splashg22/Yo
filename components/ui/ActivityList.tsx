"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Activity } from "@/lib/contract";
import { shortAddress } from "@/lib/format";
import { Time } from "./Money";

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
      {activity === null && !problem && <p className="body">Reading the chain.</p>}
      {activity?.length === 0 && <p className="body">{empty}</p>}
      {activity !== null && activity.length > 0 && (
        <div className="table-wrap">
          <table className="grid" data-activity>
            <thead>
              <tr>
                <th>When</th>
                <th>Transaction</th>
                <th>State</th>
                <th className="r">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((entry) => (
                <tr key={entry.signature}>
                  <td>{entry.blockTime === undefined ? <span className="quiet">Not recorded</span> : <Time at={entry.blockTime * 1000} />}</td>
                  <td>
                    <span className="address" title={entry.signature}>
                      {shortAddress(entry.signature)}
                    </span>
                  </td>
                  <td>{entry.failed ? <span className="tag hot">Failed: only the network fee moved</span> : <span className="tag">Confirmed</span>}</td>
                  <td className="r">
                    <Link className="link" href={`/tx/${entry.signature}`}>
                      Receipt
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
