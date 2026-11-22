"use client";

/**
 * The candlestick chart: candles, volume, the last price, a crosshair with a read-out, and marks for trades
 * worth pointing at (the person's own buys and sells, the creator's). Drawn on a canvas by this file alone.
 *
 * It draws only when something changed, at most once per animation frame, straight from the candle store:
 * a stream of trades updates the newest candle without React re-rendering anything.
 *
 * Drag to scroll back (older candles load as the left edge is reached), wheel or pinch to zoom, double
 * click to return to the present.
 */
import { useEffect, useRef } from "react";
import type { Series } from "@/lib/client/coin-store";
import { niceTicks, priceRange, timeLabel, visibleRange } from "@/lib/chart/scale";
import { formatCompact } from "@/lib/format";

export interface Mark {
  /** Seconds. */
  at: number;
  side: "buy" | "sell";
  /** Whose trade: the person looking, or the coin's creator. */
  who: "me" | "creator";
  /** The price after the trade, in millionths of a lamport per coin. */
  price: number;
}
export interface ChartView {
  /** What the vertical axis measures. */
  measure: "price" | "cap";
  unit: "sol" | "usd";
  /** Whole coins in existence, for market cap. */
  supplyCoins: number;
  /** Dollars per SOL, or null: then the chart stays in SOL whatever was asked. */
  solUsd: number | null;
}

const AXIS = 70;
const FOOT = 20;
const DEFAULT_BAR = 9;

export function CandleChart({ series, view, marks, onRead }: { series: Series; view: ChartView; marks: Mark[]; onRead?: (text: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Everything the drawing loop reads lives in refs, so a new prop never restarts the loop.
  const live = useRef({ series, view, marks, onRead });
  live.current = { series, view, marks, onRead };
  const dirty = useRef(true);
  useEffect(() => {
    dirty.current = true;
  }, [series, view, marks]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const styles = getComputedStyle(document.documentElement);
    const ink = styles.getPropertyValue("--ink").trim() || "#fff";
    // The accent is written once, in the stylesheet. Without it (a stylesheet that failed to load) the marks are drawn in white.
    const accent = styles.getPropertyValue("--accent").trim() || "#fff";
    const mono = `11px ${styles.getPropertyValue("--mono").trim() || "monospace"}`;
    const faint = "rgba(255,255,255,0.10)";
    const mute = "rgba(255,255,255,0.62)";

    let width = 0;
    let height = 0;
    let barWidth = DEFAULT_BAR;
    let offset = 0; // candles scrolled back from the present
    let pointer: { x: number; y: number } | null = null;
    let drawnVersion = -1;
    let drawnSeries: Series | null = null;
    let frame = 0;
    let stopped = false;

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      width = box.width;
      height = box.height;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      dirty.current = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let firstCandlesMarked = false;
    const draw = () => {
      const { series: current, view: shown, marks: pins, onRead: read } = live.current;
      const rows = current.rows;
      const plotWidth = Math.max(10, width - AXIS);
      const plotHeight = Math.max(10, height - FOOT);
      const volumeHeight = Math.round(plotHeight * 0.18);
      const priceHeight = plotHeight - volumeHeight - 6;
      const usd = shown.unit === "usd" && shown.solUsd !== null ? shown.solUsd : 1;
      const scale = (shown.measure === "cap" ? shown.supplyCoins : 1) * usd;
      const value = (raw: number): number => (raw / 1e15) * scale;
      const prefix = shown.unit === "usd" && shown.solUsd !== null ? "$" : "";

      context.clearRect(0, 0, width, height);
      // For the performance test: the moment candles are first on the screen, measured from when the page began.
      if (rows.length > 0 && !firstCandlesMarked) {
        firstCandlesMarked = true;
        performance.mark("chart:first-candles");
      }
      context.font = mono;
      context.textBaseline = "middle";
      if (rows.length === 0) return read?.("");

      // Scrolling back cannot go past the oldest candle.
      offset = Math.max(0, Math.min(offset, Math.max(0, rows.length - 3)));
      const { first, last } = visibleRange(rows.length, plotWidth - barWidth, barWidth, offset);
      const { low, high } = priceRange(rows, first, last, value);
      const y = (amount: number): number => 4 + (1 - (amount - low) / (high - low)) * (priceHeight - 8);
      const x = (index: number): number => plotWidth - barWidth - (last - index) * barWidth - barWidth / 2;
      let busiest = 0;
      for (let index = first; index <= last; index++) busiest = Math.max(busiest, rows[index]![5]!);

      // Horizontal lines and their labels.
      context.lineWidth = 1;
      for (const tick of niceTicks(low, high, 5)) {
        const at = Math.round(y(tick)) + 0.5;
        context.strokeStyle = faint;
        context.beginPath();
        context.moveTo(0, at);
        context.lineTo(plotWidth, at);
        context.stroke();
        context.fillStyle = mute;
        context.textAlign = "left";
        context.fillText(`${prefix}${formatCompact(tick)}`, plotWidth + 6, at);
      }
      // Time labels: about one every hundred pixels.
      const every = Math.max(1, Math.round(100 / barWidth));
      context.textAlign = "center";
      context.fillStyle = mute;
      for (let index = last; index >= first; index -= every) context.fillText(timeLabel(rows[index]![0]!, current.tf), x(index), plotHeight + FOOT / 2);

      // Volume, then candles.
      const body = Math.max(1, Math.floor(barWidth * 0.72));
      for (let index = first; index <= last; index++) {
        const [, open, top, bottom, close, volume] = rows[index] as [number, number, number, number, number, number];
        const centre = Math.round(x(index));
        const rising = close >= open;
        // Volume bars are the candle's own colour, faint. The accent is read from the stylesheet, never written here.
        context.fillStyle = rising ? ink : accent;
        context.globalAlpha = rising ? 0.3 : 0.42;
        if (busiest > 0 && volume > 0) {
          const tall = Math.max(1, Math.round((volume / busiest) * volumeHeight));
          context.fillRect(centre - Math.floor(body / 2), plotHeight - tall, body, tall);
        }
        context.globalAlpha = 1;
        context.fillStyle = context.strokeStyle = rising ? ink : accent;
        context.beginPath();
        context.moveTo(centre + 0.5, Math.round(y(value(top))));
        context.lineTo(centre + 0.5, Math.round(y(value(bottom))));
        context.stroke();
        const from = Math.round(y(value(Math.max(open, close))));
        const to = Math.round(y(value(Math.min(open, close))));
        context.fillRect(centre - Math.floor(body / 2), from, body, Math.max(1, to - from));
      }

      // Trades worth pointing at: a small triangle at the trade's price, in its candle.
      for (const pin of pins) {
        const bucket = pin.at - (pin.at % current.tf);
        if (bucket < rows[first]![0]! || bucket > rows[last]![0]!) continue;
        let index = first;
        while (index < last && rows[index + 1]![0]! <= bucket) index += 1;
        const centre = Math.round(x(index));
        const at = y(value(pin.price));
        const up = pin.side === "buy";
        context.fillStyle = up ? ink : accent;
        context.beginPath();
        context.moveTo(centre, at + (up ? 6 : -6));
        context.lineTo(centre - 5, at + (up ? 15 : -15));
        context.lineTo(centre + 5, at + (up ? 15 : -15));
        context.closePath();
        context.fill();
        if (pin.who === "creator") {
          // The creator's trades carry a square outline as well, so they are told apart without relying on colour.
          context.strokeStyle = up ? ink : accent;
          context.strokeRect(centre - 7.5, at + (up ? 4.5 : -17.5), 15, 13);
        }
      }

      // The last price: a dashed line across, with its figure on the axis.
      const lastClose = value(rows[rows.length - 1]![4]!);
      if (lastClose >= low && lastClose <= high) {
        const at = Math.round(y(lastClose)) + 0.5;
        context.setLineDash([3, 3]);
        context.strokeStyle = ink;
        context.beginPath();
        context.moveTo(0, at);
        context.lineTo(plotWidth, at);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = ink;
        context.fillRect(plotWidth, at - 8, AXIS, 16);
        context.fillStyle = "#000";
        context.textAlign = "left";
        context.fillText(`${prefix}${formatCompact(lastClose)}`, plotWidth + 6, at);
      }

      // The crosshair, and the read-out for the candle under it (or the newest one).
      let reading = rows[rows.length - 1]!;
      if (pointer && pointer.x < plotWidth && pointer.y < plotHeight) {
        const index = Math.max(first, Math.min(last, last - Math.round((plotWidth - barWidth - barWidth / 2 - pointer.x) / barWidth)));
        reading = rows[index]!;
        const centre = Math.round(x(index)) + 0.5;
        context.strokeStyle = "rgba(255,255,255,0.4)";
        context.beginPath();
        context.moveTo(centre, 0);
        context.lineTo(centre, plotHeight);
        context.moveTo(0, Math.round(pointer.y) + 0.5);
        context.lineTo(plotWidth, Math.round(pointer.y) + 0.5);
        context.stroke();
        if (pointer.y < priceHeight) {
          const amount = low + (1 - (pointer.y - 4) / (priceHeight - 8)) * (high - low);
          context.fillStyle = "#000";
          context.fillRect(plotWidth, pointer.y - 8, AXIS, 16);
          context.strokeRect(plotWidth + 0.5, Math.round(pointer.y) - 7.5, AXIS - 1, 15);
          context.fillStyle = ink;
          context.textAlign = "left";
          context.fillText(`${prefix}${formatCompact(amount)}`, plotWidth + 6, pointer.y);
        }
      }
      const figure = (raw: number): string => `${prefix}${formatCompact(value(raw))}`;
      read?.(
        `${timeLabel(reading[0]!, current.tf)}  O ${figure(reading[1]!)}  H ${figure(reading[2]!)}  L ${figure(reading[3]!)}  C ${figure(reading[4]!)}  V ${formatCompact(reading[5]! / 1e9)} SOL  ${reading[6]} trade${reading[6] === 1 ? "" : "s"}`,
      );

      // Dragged back to the oldest candle held: ask for the ones before it.
      if (first <= 3 && !current.complete && !current.loading) void current.older().catch(() => undefined);
    };

    const loop = () => {
      if (stopped) return;
      const { series: current } = live.current;
      if (dirty.current || current.version !== drawnVersion || current !== drawnSeries) {
        if (current !== drawnSeries) offset = 0;
        drawnVersion = current.version;
        drawnSeries = current;
        dirty.current = false;
        draw();
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    // ---- hands on the chart ----
    const touching = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const where = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    const down = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      touching.set(event.pointerId, where(event));
      if (touching.size === 2) {
        const [a, b] = [...touching.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (event: PointerEvent) => {
      const at = where(event);
      const before = touching.get(event.pointerId);
      if (before) {
        touching.set(event.pointerId, at);
        if (touching.size === 2) {
          const [a, b] = [...touching.values()] as [{ x: number; y: number }, { x: number; y: number }];
          const apart = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinch > 0) barWidth = Math.max(2, Math.min(48, barWidth * (apart / pinch)));
          pinch = apart;
        } else offset += (at.x - before.x) / barWidth;
      }
      pointer = event.pointerType === "touch" && !before ? null : at;
      dirty.current = true;
    };
    const up = (event: PointerEvent) => {
      touching.delete(event.pointerId);
      pinch = 0;
    };
    const leave = () => {
      pointer = null;
      dirty.current = true;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) offset += (event.deltaX || event.deltaY) / barWidth;
      else barWidth = Math.max(2, Math.min(48, barWidth * Math.exp(-event.deltaY * 0.0015)));
      dirty.current = true;
    };
    const home = () => {
      offset = 0;
      barWidth = DEFAULT_BAR;
      dirty.current = true;
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("dblclick", home);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("dblclick", home);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Candlestick chart of this coin's price. The figures for the newest candle are read out beside the chart's controls."
    />
  );
}
