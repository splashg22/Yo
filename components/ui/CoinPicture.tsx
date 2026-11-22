"use client";

import { useEffect, useState } from "react";

/**
 * A coin's picture at a fixed size, so nothing moves when it arrives. A coin with no picture,
 * or one whose picture cannot be fetched, shows the first letter of its ticker in the same box.
 */
/** How long after a picture did not come before it is asked for again. The server may still be fetching it. */
const RETRY_MS = [3_000, 10_000, 30_000];

export function CoinPicture({ image, symbol, size = 48 }: { image?: string; symbol: string; size?: number }) {
  // The letter is there from the first paint. The picture is drawn over it once it has arrived, and never if it does not.
  const [shown, setShown] = useState(false);
  const [tries, setTries] = useState(0);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const delay = RETRY_MS[tries];
    if (delay === undefined) return;
    const timer = setTimeout(() => {
      setWaiting(false);
      setTries(tries + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [waiting, tries]);
  const box = { width: size, height: size };
  const ours = image?.startsWith("/coin-image/") === true;
  const address = (width: number): string => {
    if (!image) return "";
    const asked = [ours ? `w=${width}` : "", tries > 0 ? `try=${tries}` : ""].filter(Boolean).join("&");
    return asked ? `${image}${image.includes("?") ? "&" : "?"}${asked}` : image;
  };
  return (
    <span className="coin-picture" style={box} aria-hidden="true">
      {symbol.slice(0, 1)}
      {image && !waiting && (
        // A plain <img>: it is already the size it is shown at, and may be this server's copy of a picture kept elsewhere.
        <img
          src={address(96)}
          // This server's own copies come at one, two and three device pixels to the pixel: sharp on every screen, never enlarged.
          {...(ours ? { srcSet: `${address(48)} 1x, ${address(96)} 2x, ${address(144)} 3x` } : {})}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          style={{ opacity: shown ? 1 : 0 }}
          onLoad={() => setShown(true)}
          onError={() => setWaiting(true)}
        />
      )}
    </span>
  );
}
