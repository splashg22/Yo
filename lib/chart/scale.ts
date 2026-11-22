/** The arithmetic behind the chart: which candles are in view, the price scale, and round figures for its labels. Pure, so it can be tested without a screen. */

/** Which candles are drawn: `count` candles, the newest `offset` of them scrolled off to the right. */
export function visibleRange(total: number, width: number, barWidth: number, offset: number): { first: number; last: number } {
  const fit = Math.max(1, Math.floor(width / barWidth));
  const last = Math.max(0, Math.min(total - 1, total - 1 - Math.round(offset)));
  return { first: Math.max(0, last - fit + 1), last };
}

/** Round, evenly spaced values across a range: about `wanted` of them. */
export function niceTicks(low: number, high: number, wanted = 5): number[] {
  if (!(high > low) || !Number.isFinite(low) || !Number.isFinite(high)) return [low];
  const rough = (high - low) / wanted;
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / power;
  const step = (unit >= 5 ? 5 : unit >= 2 ? 2 : 1) * power;
  const ticks: number[] = [];
  for (let value = Math.ceil(low / step) * step; value <= high + step * 1e-9; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}

/** The lowest low and highest high among rows `first` to `last`, with a little room above and below. */
export function priceRange(rows: number[][], first: number, last: number, value: (raw: number) => number): { low: number; high: number } {
  let low = Infinity;
  let high = -Infinity;
  for (let index = first; index <= last; index++) {
    const row = rows[index];
    if (!row) continue;
    low = Math.min(low, value(row[3]!));
    high = Math.max(high, value(row[2]!));
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return { low: 0, high: 1 };
  if (high === low) {
    const pad = high === 0 ? 1 : Math.abs(high) * 0.05;
    return { low: low - pad, high: high + pad };
  }
  const pad = (high - low) * 0.08;
  return { low: Math.max(0, low - pad), high: high + pad };
}

/** A label for a moment on the time axis, sized to the timeframe: seconds charts show the clock, daily charts the date. */
export function timeLabel(seconds: number, timeframe: number): string {
  const date = new Date(seconds * 1000);
  const two = (value: number): string => String(value).padStart(2, "0");
  if (timeframe >= 86_400) return `${date.getDate()} ${date.toLocaleString("en-US", { month: "short" })}`;
  if (timeframe >= 3600) return `${date.getDate()} ${date.toLocaleString("en-US", { month: "short" })} ${two(date.getHours())}:00`;
  if (timeframe >= 60) return `${two(date.getHours())}:${two(date.getMinutes())}`;
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}
