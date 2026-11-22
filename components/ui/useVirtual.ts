"use client";

/**
 * A long list drawn as a short one: only the rows in view (and a few either side) exist in the page, each
 * placed at its own height inside a box as tall as the whole list. A feed of thousands of trades costs the
 * same to draw as one of twenty.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export function useVirtual(count: number, rowHeight: number, overscan = 6) {
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const measure = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    setView((current) =>
      current.top === element.scrollTop && current.height === element.clientHeight ? current : { top: element.scrollTop, height: element.clientHeight },
    );
  }, []);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [measure]);
  const first = Math.max(0, Math.floor(view.top / rowHeight) - overscan);
  const last = Math.min(count - 1, Math.ceil((view.top + view.height) / rowHeight) + overscan);
  return {
    scroller,
    /** The height of the whole list, for the inner box. */
    total: count * rowHeight,
    first,
    last,
    /** Where row `index` goes. */
    place: (index: number) => ({ top: index * rowHeight, height: rowHeight }),
    /** True when the list is scrolled to its top, where new rows arrive. */
    atTop: view.top < rowHeight,
  };
}
