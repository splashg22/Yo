import type { Metadata } from "next";
import { CHANGELOG } from "@/lib/changelog";

export const metadata: Metadata = { title: "Changelog" };

export default function Page() {
  return (
    <div className="page">
      <div className="wrap">
        <span className="label">Changelog</span>
        <h1 className="h2">What changed, and when</h1>
        <p className="body">Dates are days, in UTC. The project is days old; there is no earlier history.</p>
        <ul className="changelog">
          {CHANGELOG.map((entry) => (
            <li key={entry.date}>
              <time className="label" dateTime={entry.date}>
                {entry.date}
              </time>
              <ul>
                {entry.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
