"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** When its content changes, shows two offset copies for about 150 ms. Nothing moves otherwise. */
export function Glitch({ id, children, className }: { id: string | number; children: ReactNode; className?: string }) {
  const [on, setOn] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setOn(true);
    const timer = setTimeout(() => setOn(false), 150);
    return () => clearTimeout(timer);
  }, [id]);
  return (
    <div className={`glitch ${className ?? ""}`} data-on={on}>
      <div>{children}</div>
      {on && (
        <div className="copy a" aria-hidden="true">
          {children}
        </div>
      )}
      {on && (
        <div className="copy b" aria-hidden="true">
          {children}
        </div>
      )}
    </div>
  );
}
