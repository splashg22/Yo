"use client";

/**
 * The site's one background: great rings that pass behind walls you cannot see.
 * The walls are the columns the content sits in, so text always has plain black behind
 * it. It is one continuous scene: every page looks at the same rings from a different
 * place, and navigating or scrolling moves the view rather than restarting it.
 */
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** Where each page stands in the scene: the rings' centre, as shares of the viewport. */
const VIEWS: Record<string, [number, number]> = {
  "/": [0.9, 1.04],
  "/explore": [0.08, 1.12],
  "/terminal": [0.08, 1.12],
  "/launch": [1.06, 0.16],
  "/wallet": [-0.06, 0.38],
  "/otc": [0.96, 0.92],
  "/pay": [0.5, 1.3],
  "/status": [0.5, -0.4],
  "/changelog": [1.1, 1.1],
  "/docs": [0.04, -0.12],
  "/terms": [1.02, 0.52],
  "/privacy": [-0.02, 0.64],
};
/** Pages without a place of their own stand where a related page does. */
function viewFor(pathname: string): [number, number] {
  if (pathname.startsWith("/coin/")) return VIEWS["/explore"]!;
  if (pathname.startsWith("/tx/")) return VIEWS["/status"]!;
  return VIEWS[pathname] ?? VIEWS["/terms"]!;
}
const RINGS = [0.34, 0.55, 0.8, 1.08, 1.42];
const MEASURE = 1120;

export function Background() {
  const pathname = usePathname();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const route = useRef(pathname);
  route.current = pathname;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#fff";
    let W = 0,
      H = 0,
      raf = 0,
      running = false,
      gaveUp = false;
    let view: [number, number] | null = null;
    let clock = 0,
      last = 0,
      slowFrames = 0,
      counted = 0;

    let mastheadElement: HTMLElement | null = null;

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      W = innerWidth;
      H = innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    /** The bands the rings go behind: wherever this page puts its text. */
    const walls = (home: boolean): [number, number][] => {
      if (W < 760) return [];
      const gutter = Math.min(72, Math.max(20, W * 0.05));
      const wide = document.querySelector<HTMLElement>("[data-bg-wide]");
      if (home && wide && wide.getBoundingClientRect().bottom > H * 0.5) {
        // While the callouts are up they flank the object, so the rings show only behind the object itself.
        if (Number(wide.dataset.step) >= 3 && W > 1180)
          return [
            [0, W * 0.27],
            [W * 0.73, W],
          ];
        return [[gutter - 20, gutter + W * 0.43]];
      }
      // A page that uses the whole width, such as the terminal, has text everywhere: no ring is drawn behind it.
      if (document.querySelector("[data-bg-full]")) return [[0, W]];
      const column = Math.min(MEASURE, W - 2 * gutter);
      return [[(W - column) / 2 - 28, (W + column) / 2 + 28]];
    };

    function draw() {
      if (!ctx) return;
      const home = route.current === "/";
      const phone = W < 760;
      const target = viewFor(route.current);
      if (!view) view = [target[0], target[1]];
      // Turned down on app pages, and further on phones, where text covers the whole width.
      const level = phone ? (home ? 0.3 : 0.18) : home ? 1 : 0.55;
      const scroll = scrollY;
      const m = Math.max(W, H);
      const cx = view[0] * W,
        cy = view[1] * H - scroll * 0.05;

      ctx.clearRect(0, 0, W, H);
      ctx.save();
      const clip = new Path2D();
      let from = 0;
      // The header and the build notice are a wall too. Reading the height is free unless the layout changed.
      mastheadElement ??= document.querySelector<HTMLElement>(".masthead");
      const top = Math.max(0, (mastheadElement?.offsetHeight ?? 0) - scroll);
      for (const [a, b] of walls(home)) {
        clip.rect(from, top, Math.max(0, a - from), H);
        from = b;
      }
      clip.rect(from, top, Math.max(0, W - from), H);
      ctx.clip(clip);

      RINGS.forEach((k, index) => {
        const r = k * m,
          band = 10 + index * 5;
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(255,255,255,${0.5 * level})`;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${0.24 * level})`;
        ctx.beginPath();
        ctx.arc(cx, cy, r + band, 0, Math.PI * 2);
        ctx.stroke();
        // Twelve short blocks travel each ring. They go dark behind a wall and come out the other side.
        const speed = (((index % 2 ? -1 : 1) * 0.012) / (k + 0.3)) * (home ? 1 : 0.5);
        const length = 0.1 / (k + 0.2);
        ctx.lineWidth = band - 3;
        ctx.lineCap = "round";
        for (let block = 0; block < 12 && !phone; block++) {
          // phones get the rings only: nothing bright passes behind text
          const a = clock * speed + scroll * 0.00035 * (index % 2 ? -1 : 1) + index * 1.7 + (block * Math.PI) / 6;
          const x = cx + Math.cos(a) * r,
            y = cy + Math.sin(a) * r;
          if (x < -200 || x > W + 200 || y < -200 || y > H + 200) continue;
          const isAccent = index === 1 && block % 4 === 0;
          ctx.strokeStyle = isAccent ? accent : `rgba(255,255,255,${0.7 * level})`;
          ctx.globalAlpha = isAccent ? Math.min(1, level + 0.15) : 1;
          ctx.beginPath();
          ctx.arc(cx, cy, r + band / 2, a, a + length);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      });
      ctx.restore();
    }

    function frame(now: number) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (now - last < 30) return; // about 30 frames a second is plenty for something this slow
      const delta = last ? now - last : 33;
      last = now;
      clock += Math.min(delta, 100) / 1000;
      const target = viewFor(route.current);
      if (view) {
        view[0] += (target[0] - view[0]) * 0.035;
        view[1] += (target[1] - view[1]) * 0.035;
      }
      const started = performance.now();
      draw();
      // A device that cannot keep up gets a still frame instead of a stutter.
      if (counted < 45) {
        counted += 1;
        if (performance.now() - started > 9 || delta > 60) slowFrames += 1;
        if (counted === 45 && slowFrames > 20) {
          gaveUp = true;
          stop();
        }
      }
    }
    const start = () => {
      if (running || gaveUp || reduced.matches || document.hidden) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }
    const onVisibility = () => (document.hidden ? stop() : start());
    const onMotion = () => (reduced.matches ? (stop(), draw()) : start());
    const onScroll = () => {
      if (!running && !reduced.matches) draw();
    };

    // Start only once the page is usable.
    let idle = 0;
    const begin = () => {
      resize();
      addEventListener("resize", resize);
      addEventListener("scroll", onScroll, { passive: true });
      document.addEventListener("visibilitychange", onVisibility);
      reduced.addEventListener("change", onMotion);
      start();
    };
    const whenLoaded = () => {
      idle = "requestIdleCallback" in window ? requestIdleCallback(begin, { timeout: 1200 }) : (setTimeout(begin, 300) as unknown as number);
    };
    if (document.readyState === "complete") whenLoaded();
    else addEventListener("load", whenLoaded, { once: true });

    return () => {
      stop();
      if ("cancelIdleCallback" in window) cancelIdleCallback(idle);
      removeEventListener("load", whenLoaded);
      removeEventListener("resize", resize);
      removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", onMotion);
    };
  }, []);

  // A still page (reduced motion, or a slow device) still moves to its own view on navigation.
  useEffect(() => {
    dispatchEvent(new Event("resize"));
  }, [pathname]);

  return <canvas ref={canvasRef} className="bg" aria-hidden="true" />;
}
