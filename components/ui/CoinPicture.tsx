"use client";

import { useState } from "react";

/**
 * A coin's picture at a fixed size, so nothing moves when it arrives. A coin with no picture,
 * or one whose picture cannot be fetched, shows the first letter of its ticker in the same box.
 */
export function CoinPicture({ image, symbol, size = 48 }: { image?: string; symbol: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };
  if (!image || failed) {
    return (
      <span className="coin-picture" style={box} aria-hidden="true">
        {symbol.slice(0, 1)}
      </span>
    );
  }
  // A plain <img>: the picture may live on another host (IPFS), and it is already the size it is shown at.
  return <img className="coin-picture" src={image} alt="" width={size} height={size} style={box} loading="lazy" onError={() => setFailed(true)} />;
}
