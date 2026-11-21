import { site } from "@/site.config";

const isPlaceholder = (value: string) => value.startsWith("[");

/** Who runs the site and how to reach them, for the legal pages. Anything not yet decided is shown as exactly that. */
export function Operator() {
  const rows: [string, string][] = [
    ["Operated by", site.operator.name],
    ["Country", site.operator.country],
    ["Contact", site.operator.contact],
  ];
  return (
    <dl className="kv">
      {rows.map(([label, value]) => (
        <span key={label} style={{ display: "contents" }}>
          <dt>{label}</dt>
          <dd>{isPlaceholder(value) ? <span className="state-bad">Not yet filled in. {value}</span> : <span className="address">{value}</span>}</dd>
        </span>
      ))}
    </dl>
  );
}
