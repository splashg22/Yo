import Link from "next/link";
import { visibilityOf } from "@/lib/visibility";

/** What one action reveals and what it encrypts. Shown before every signature. */
export function PrivacyPanel({ action, realRing = false }: { action: string; realRing?: boolean }) {
  const row = visibilityOf(action);
  // Where the real program is connected, an action done through it is described as it is done there.
  const real = realRing ? row.realRing : undefined;
  return (
    <div className="panel">
      <span className="label">Before you sign: {row.action}</span>
      <dl>
        <div>
          <dt>Public</dt>
          {row.public.map((item) => (
            <dd key={item} className="pub">
              {item}
            </dd>
          ))}
        </div>
        <div>
          <dt>Encrypted by a Ring</dt>
          {row.encrypted.length ? (
            row.encrypted.map((item) => (
              <dd key={item} className="enc">
                {item}
              </dd>
            ))
          ) : (
            <dd>Nothing</dd>
          )}
        </div>
      </dl>
      {row.note && <p className="body">{row.note}</p>}
      <p className="body" data-server>
        This site&apos;s server sees: {real?.server ?? row.server}
      </p>
      <p className="body">
        {row.proof.real || real ? "How it is done: " : "In this build: "}
        {real?.today ?? row.proof.today}{" "}
        <Link className="link" href="/technical#check-it-yourself">
          How to check
        </Link>
      </p>
    </div>
  );
}
