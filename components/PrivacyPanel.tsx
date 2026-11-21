import { visibilityOf } from "@/lib/visibility";

/** What one action reveals and what it encrypts. Shown before every signature. */
export function PrivacyPanel({ action }: { action: string }) {
  const row = visibilityOf(action);
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
          <dt>Encrypted</dt>
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
    </div>
  );
}
