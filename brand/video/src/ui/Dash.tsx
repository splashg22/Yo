// The dashboard's panels and the history panel, rebuilt with the site's own markup and CSS (web/ui.css)
// and the texts the live page showed at capture time (src/captured.json), so the parts can move.
import React from "react";
import { interpolate } from "remotion";
import captured from "../captured.json";
import { POP, SOFT, ease, lin, ms, pop } from "../theme";

const D = captured.dashboard;
const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const easeOutCubic = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
/** The site's own count-up (web/motion.js frameText): 0 → the shown value, ease-out cubic. */
export const countText = (shown: string, t: number) => {
  const value = Number(shown.replace(/,/g, ""));
  if (!Number.isFinite(value) || value === 0) return shown;
  return group(Math.round(value * easeOutCubic(t)));
};

export const Overview: React.FC<{ frame: number; start: number; fps: number; countStart: number; countDur?: number }> = ({ frame, start, fps, countStart, countDur = 90 }) => {
  const a = ease(frame, start, 50);
  return (
    <div className="panel" id="overview" style={{ width: 1200, opacity: a, transform: `translateY(${(1 - a) * 40}px)` }}>
      {D.overview.map((it, i) => {
        const o = ease(frame, start + 10 + i * ms(70), 30);
        const t = lin(frame, countStart, countDur);
        return (
          <div className="item" key={it.label} style={{ opacity: o, transform: `translateY(${(1 - o) * 10}px)` }}>
            <div className="label">{it.label}</div>
            <div className="value"><span className="num">{countText(it.value, t)}</span><small>{it.unit}</small></div>
            <div className="sub" dangerouslySetInnerHTML={{ __html: it.sub }} />
          </div>
        );
      })}
    </div>
  );
};

export const Kpis: React.FC<{ frame: number; start: number; fps: number }> = ({ frame, start, fps }) => (
  <div className="grid cols-4" style={{ width: 1200 }}>
    {D.kpis.map((k, i) => {
      const p = pop(frame, fps, start + i * ms(60), POP);
      const o = ease(frame, start + i * ms(60), 16);
      return (
        <div className="tile" key={k.label} style={{ opacity: o, transform: `translateY(${(1 - p) * 18}px) scale(${0.94 + 0.06 * p})` }}>
          <div className="label">{k.label}</div>
          <div className="value"><span className="num">{k.value}</span><small>{k.unit}</small></div>
          <div className="sub">{k.sub}</div>
        </div>
      );
    })}
  </div>
);

export const HistoryPanel: React.FC<{ frame: number; start: number; fps: number }> = ({ frame, start, fps }) => {
  const p = pop(frame, fps, start, SOFT), o = ease(frame, start, 20);
  const head = ease(frame, start + 70, 24);
  const typed = lin(frame, start + 90, 90);
  const empty = D.tableBody;
  const shown = empty.slice(0, Math.floor(typed * empty.length));
  return (
    <div className="panel" style={{ width: 1200, opacity: o, transform: `scale(${0.97 + 0.03 * p})`, transformOrigin: "50% 0%" }}>
      <div className="panel-head"><h3>Treasury history</h3><span className="caption">{D.activityNote}</span></div>
      <div id="filters" role="group">
        {D.filters.map((c, i) => {
          const q = pop(frame, fps, start + 20 + i * ms(50), POP), oo = ease(frame, start + 20 + i * ms(50), 12);
          return <button type="button" className="chip" key={c.label} aria-pressed={c.pressed} style={{ opacity: oo, transform: `scale(${0.8 + 0.2 * q})` }}>{c.label}</button>;
        })}
      </div>
      <div className="table-wrap" style={{ opacity: head }}>
        <table>
          <thead><tr>{D.tableHead.map((h) => <th key={h} className={h === "Amount" ? "amt" : h === "When" ? "hide-sm" : undefined}>{h}</th>)}</tr></thead>
          <tbody>
            {D.rowCount === 0 ? (
              <tr><td colSpan={5} className="table-empty">{shown}<span style={{ opacity: typed < 1 && Math.floor(frame / 16) % 2 === 0 ? 1 : 0 }}>|</span></td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="caption" style={{ margin: "14px 0 0", minHeight: 20 }} />
    </div>
  );
};

export const Addresses: React.FC<{ frame: number; start: number; copiedFrom?: number; copiedTo?: number }> = ({ frame, start, copiedFrom = Infinity, copiedTo = Infinity }) => (
  <div className="addresses" style={{ width: 1200, marginTop: 0 }}>
    {D.addresses.map((a, i) => {
      const o = ease(frame, start + i * ms(70), 40);
      const done = i === 0 && frame >= copiedFrom && frame < copiedTo;
      return (
        <div className="addr" key={a.k} style={{ opacity: o, transform: `translateY(${(1 - o) * 26}px)` }}>
          <span className="k">{a.k}</span><code>{a.v}</code>
          <button type="button" className="copy" {...(done ? { "data-done": "" } : {})}>{done ? "Copied" : "Copy"}</button>
          <a className="out">↗</a>
        </div>
      );
    })}
  </div>
);

/** The split bar (the dashboard's own #bar styling) drawn on in three segments, with the percentages counting. */
export const SplitBar: React.FC<{ frame: number; start: number; width: number; active: number }> = ({ frame, start, width, active }) => {
  const segs = [
    { cls: "a", pct: 40, k: "burns DCTY", pc: "pct-burn", at: 0, glow: "rgba(255,45,149,.7)" },
    { cls: "b", pct: 20, k: "buys back", pc: "pct-buyback", at: 40, glow: "rgba(182,92,255,.7)" },
    { cls: "c", pct: 40, k: "to holders", pc: "pct-holders", at: 60, glow: "rgba(62,232,255,.7)" },
  ];
  const starts = [start, start + 40, start + 70];
  const prog = segs.map((_, i) => ease(frame, starts[i], i === 1 ? 36 : 50));
  return (
    <div style={{ position: "relative", width }}>
      <div id="bar" style={{ overflow: "visible" }}>
        {segs.map((sg, i) => (
          <i key={sg.cls} className={sg.cls} style={{ width: `${sg.pct * prog[i]}%`, boxShadow: active === i ? `0 0 16px ${sg.glow}` : "none", borderRadius: i === 0 ? "999px 0 0 999px" : i === 2 ? "0 999px 999px 0" : 0 }} />
        ))}
      </div>
      <div id="split" style={{ display: "block", marginTop: 18, position: "relative", height: 90 }}>
        {segs.map((sg, i) => {
          const t = prog[i];
          return (
            <div key={sg.cls} style={{ position: "absolute", left: `${sg.at}%`, top: 0, opacity: interpolate(t, [0, 0.2], [0, 1], { extrapolateRight: "clamp" }) }}>
              <div className={`p ${sg.pc}`} style={{ margin: 0, fontSize: 40, lineHeight: 1 }}>{Math.round(sg.pct * easeOutCubic(t))}%</div>
              <div className="k" style={{ fontSize: 15, marginTop: 6 }}>{sg.k}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
