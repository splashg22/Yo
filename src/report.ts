/** Turns the ledger into totals and a self-contained public stats page. */
import { formatUnits } from "./amounts.js";

export interface LedgerRow {
  time?: string;
  type: string;
  cycle: number;
  signature?: string;
  [key: string]: unknown;
}

export interface Summary {
  cycles: number;
  claimed: bigint;
  swapped: bigint;
  burned: bigint;
  boughtBack: bigint;
  selfBurned: bigint;
  paid: bigint;
  payoutTransfers: number;
  recipients: number;
  lastActivity: string | null;
  topRecipients: { owner: string; amount: bigint }[];
  recent: { time: string; type: string; text: string; signature: string }[];
}

export interface Units {
  quoteDecimals: number;
  burnDecimals: number;
  quoteSymbol: string;
  burnSymbol: string;
  /** The strategy coin that is bought back and burned. Defaults to the burn coin's units. */
  strategyDecimals?: number;
  strategySymbol?: string;
}

const big = (value: unknown) => BigInt(typeof value === "string" || typeof value === "number" ? value : 0);

export function parseLedger(text: string): LedgerRow[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as LedgerRow);
}

export function summarize(rows: readonly LedgerRow[], units: Units): Summary {
  const q = (amount: bigint) => `${formatUnits(amount, units.quoteDecimals)} ${units.quoteSymbol}`;
  const b = (amount: bigint) => `${formatUnits(amount, units.burnDecimals)} ${units.burnSymbol}`;
  const s = (amount: bigint) => `${formatUnits(amount, units.strategyDecimals ?? units.burnDecimals)} ${units.strategySymbol ?? "of the coin"}`;
  const perOwner = new Map<string, bigint>();
  const summary: Summary = {
    cycles: 0, claimed: 0n, swapped: 0n, burned: 0n, boughtBack: 0n, selfBurned: 0n, paid: 0n, payoutTransfers: 0, recipients: 0,
    lastActivity: null, topRecipients: [], recent: [],
  };
  for (const row of rows) {
    summary.cycles = Math.max(summary.cycles, row.cycle);
    let text: string | null = null;
    if (row.type === "claim") {
      summary.claimed += big(row.claimed);
      text = `Claimed ${q(big(row.claimed))} in creator fees`;
    } else if (row.type === "swap") {
      summary.swapped += big(row.spent);
      text = `Bought ${b(big(row.bought))} with ${q(big(row.spent))}`;
    } else if (row.type === "burn") {
      summary.burned += big(row.burned);
      text = `Burned ${b(big(row.burned))}`;
    } else if (row.type === "buyback") {
      summary.boughtBack += big(row.spent);
      text = `Bought back ${s(big(row.bought))} with ${q(big(row.spent))}`;
    } else if (row.type === "buyback_burn") {
      summary.selfBurned += big(row.burned);
      text = `Burned ${s(big(row.burned))} (buyback)`;
    } else if (row.type === "payout") {
      const payouts = (row.payouts as { owner: string; amount: string }[] | undefined) ?? [];
      let total = 0n;
      for (const payout of payouts) {
        total += big(payout.amount);
        perOwner.set(payout.owner, (perOwner.get(payout.owner) ?? 0n) + big(payout.amount));
      }
      summary.paid += total;
      summary.payoutTransfers += payouts.length;
      text = `Paid ${q(total)} to ${payouts.length} holder${payouts.length === 1 ? "" : "s"}`;
    }
    if (text && row.signature) {
      summary.lastActivity = row.time ?? summary.lastActivity;
      summary.recent.push({ time: row.time ?? "", type: row.type, text, signature: row.signature });
    }
  }
  summary.recipients = perOwner.size;
  summary.topRecipients = [...perOwner]
    .map(([owner, amount]) => ({ owner, amount }))
    .sort((x, y) => (x.amount === y.amount ? (x.owner < y.owner ? -1 : 1) : x.amount > y.amount ? -1 : 1))
    .slice(0, 25);
  summary.recent = summary.recent.slice(-100).reverse();
  return summary;
}

/** For headline tiles: thousands separators and at most `places` decimals (cut, not rounded up). */
export function displayAmount(amount: bigint, decimals: number, places = 2): string {
  const [whole = "0", fraction = ""] = formatUnits(amount, decimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cut = fraction.slice(0, places).replace(/0+$/, "");
  return cut ? `${grouped}.${cut}` : grouped;
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const short = (address: string) => (address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address);

export function renderHtml(summary: Summary, units: Units, meta: { title: string; treasury: string; generated: string }): string {
  const q = (amount: bigint) => formatUnits(amount, units.quoteDecimals);
  const tile = (label: string, value: string, unit: string) =>
    `<div class="tile"><div class="label">${escape(label)}</div><div class="value">${escape(value)}</div><div class="unit">${escape(unit)}</div></div>`;
  const recent = summary.recent
    .map((e) => `<tr><td class="muted nowrap">${escape(e.time.replace("T", " ").slice(0, 16))}</td><td>${escape(e.text)}</td><td class="nowrap"><a href="https://solscan.io/tx/${escape(e.signature)}" rel="noopener">${escape(short(e.signature))}</a></td></tr>`)
    .join("\n");
  const top = summary.topRecipients
    .map((r, i) => `<tr><td class="muted">${i + 1}</td><td><a href="https://solscan.io/account/${escape(r.owner)}" rel="noopener">${escape(short(r.owner))}</a></td><td class="num">${escape(q(r.amount))}</td></tr>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(meta.title)}</title>
<style>
  :root { --bg:#f7f7f5; --card:#fff; --ink:#16181d; --muted:#6b7280; --line:#e5e7eb; --accent:#c2410c; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1115; --card:#181b21; --ink:#eceef2; --muted:#9aa1ad; --line:#2a2e37; --accent:#fb923c; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width:880px; margin:0 auto; padding:32px 16px 64px; }
  h1 { font-size:1.6rem; margin:0 0 4px; } h2 { font-size:1.05rem; margin:32px 0 8px; }
  .muted { color:var(--muted); } p.muted { margin:0 0 20px; font-size:.9rem; overflow-wrap:anywhere; }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; }
  .tile, .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; }
  .label { color:var(--muted); font-size:.8rem; text-transform:uppercase; letter-spacing:.04em; }
  .value { font-size:1.4rem; font-weight:650; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
  .unit { color:var(--muted); font-size:.85rem; }
  .card { padding:4px 16px; overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:.92rem; }
  td { padding:9px 8px 9px 0; border-bottom:1px solid var(--line); vertical-align:top; }
  tr:last-child td { border-bottom:0; } td.num { text-align:right; font-variant-numeric:tabular-nums; }
  .nowrap { white-space:nowrap; }
  a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
</style>
</head>
<body>
<main>
<h1>${escape(meta.title)}</h1>
<p class="muted">Every entry below links to its on-chain transaction. Treasury <a href="https://solscan.io/account/${escape(meta.treasury)}" rel="noopener">${escape(meta.treasury)}</a> · updated ${escape(meta.generated.replace("T", " ").slice(0, 16))} UTC</p>
<div class="tiles">
${tile("Burned", displayAmount(summary.burned, units.burnDecimals, 0), units.burnSymbol)}
${tile("Bought back and burned", displayAmount(summary.selfBurned, units.strategyDecimals ?? units.burnDecimals, 0), units.strategySymbol ?? "of the coin")}
${tile("Paid to holders", displayAmount(summary.paid, units.quoteDecimals, 4), units.quoteSymbol)}
${tile("Fees claimed", displayAmount(summary.claimed, units.quoteDecimals, 4), units.quoteSymbol)}
${tile("Holders rewarded", String(summary.recipients), `${summary.payoutTransfers} transfers · ${summary.cycles} cycles`)}
</div>
<h2>Recent activity</h2>
<div class="card"><table>${recent || '<tr><td class="muted">Nothing yet.</td></tr>'}</table></div>
<h2>Top reward recipients</h2>
<div class="card"><table>${top || '<tr><td class="muted">Nothing yet.</td></tr>'}</table></div>
</main>
</body>
</html>
`;
}
