"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { formatPrice, formatTime } from "@/lib/format";

type Point = { at: number; microLamportsPerCoin: string };
const WIDTH = 620;
const HEIGHT = 180;

/**
 * The prices this site has read for a coin, as a stepped line. It is a record of readings,
 * not a full trade history: a point exists for each time the price was seen to change, or a
 * minute had passed. Time runs left to right at an even pace, so a burst of trades shows as a step.
 * Coordinates are for drawing only; every figure shown as text is formatted from the exact integer.
 */
export function PriceChart({ mint, version }: { mint: string; version: string }) {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    api("coin/candles", { mint, tf: 60 }).then(
      (answer) => {
        // One reading per candle, plus where the first one opened, so a coin with a single trade still shows a line.
        const first = answer.candles[0];
        setPoints([
          ...(first ? [{ at: first[0]! * 1000, microLamportsPerCoin: String(first[1]) }] : []),
          ...answer.candles.map((candle) => ({ at: candle[0]! * 1000 + 59_000, microLamportsPerCoin: String(candle[4]) })),
        ]);
        setProblem("");
      },
      (error: unknown) => setProblem(error instanceof Error ? error.message : String(error)),
    );
  }, [mint, version]);

  if (problem) {
    return (
      <p className="notice" role="alert">
        The price record could not be read: {problem}
      </p>
    );
  }
  if (points === null) return <p className="body">Reading the price record.</p>;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || points.length < 2) return <p className="body">One reading so far. A line appears once the price has been seen to move.</p>;

  const values = points.map((point) => BigInt(point.microLamportsPerCoin));
  const low = values.reduce((a, b) => (b < a ? b : a));
  const high = values.reduce((a, b) => (b > a ? b : a));
  const span = high - low;
  const duration = Math.max(1, last.at - first.at);
  const x = (at: number) => ((at - first.at) / duration) * WIDTH;
  // Scaled in whole thousandths of the range, so no precision is lost before the last, drawing-only division.
  const y = (value: bigint) => (span === 0n ? HEIGHT / 2 : HEIGHT - (Number(((value - low) * 1000n) / span) / 1000) * HEIGHT);
  let path = `M0 ${y(values[0]!).toFixed(1)}`;
  points.forEach((point, index) => {
    if (index > 0) path += ` H${x(point.at).toFixed(1)} V${y(values[index]!).toFixed(1)}`;
  });
  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Price from ${formatPrice(first.microLamportsPerCoin)} to ${formatPrice(last.microLamportsPerCoin)}`}
      >
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption>
        <span>
          <span className="label">Low</span> <span className="num">{formatPrice(low)}</span>
        </span>
        <span>
          <span className="label">High</span> <span className="num">{formatPrice(high)}</span>
        </span>
        <span>
          <span className="label">From</span> {formatTime(first.at)}
        </span>
        <span>
          <span className="label">Readings</span> <span className="num">{points.length}</span>
        </span>
      </figcaption>
    </figure>
  );
}
