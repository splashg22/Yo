"use client";

/**
 * The top of the homepage. The stage stays put while the page scrolls, and the scroll
 * position picks which frame of brand/hero.mp4 is on screen: the ring turns, then comes
 * apart into its five layers, and the callouts name them.
 *
 * With reduced motion this component is hidden by CSS and <StillStory> shows instead.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import media from "@/lib/media.json";
import { site } from "@/site.config";
import { CalloutBoxes, CalloutList } from "./Callouts";
import { Glitch } from "./Glitch";

const END_OF_MOTION = 0.74; // the share of the scroll the frames take; the rest holds on the layers
// Where the words change. The last step waits until the object has reached the middle.
const STEPS = [0.12, 0.38, 0.6, END_OF_MOTION + 0.02];

export const srcSet = (name: string) => media.stillWidths.map((w) => `/media/${name}-${w}.webp ${w}w`).join(", ");

export function Sequence() {
  const section = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frameBox = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const el = section.current,
      cv = canvas.current,
      box = frameBox.current;
    const ctx = cv?.getContext("2d");
    if (!el || !cv || !box || !ctx) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Pick the frame size for this screen. Small or modest devices get the small set: a sharp
    // frame that arrives late is worse than a slightly soft one that keeps up with the finger.
    const modest = (navigator.hardwareConcurrency ?? 8) <= 4 || ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
    const wantedWidth = box.clientWidth * Math.min(devicePixelRatio || 1, innerWidth < 760 ? 1.4 : 2) * (modest ? 0.6 : 1);
    const width = media.sequenceWidths.find((w) => w >= Math.min(1920, wantedWidth * 0.9)) ?? 1920;
    cv.width = width;
    cv.height = Math.round((width * 9) / 16);
    const images = new Array<HTMLImageElement | undefined>(media.frames);
    let wanted = 0,
      shown = -1,
      ticking = false;

    const paint = () => {
      // The nearest frame that has arrived, so scrolling never waits on the network.
      let best = -1;
      for (let d = 0; d < media.frames && best < 0; d++) {
        if (images[wanted - d]?.complete) best = wanted - d;
        else if (images[wanted + d]?.complete) best = wanted + d;
      }
      if (best < 0 || best === shown) return;
      ctx.clearRect(0, 0, cv.width, cv.height); // frames are transparent around the object
      ctx.drawImage(images[best]!, 0, 0, cv.width, cv.height);
      shown = best;
      cv.dataset.frame = String(best); // read by scripts/motion.mjs to check the frame follows the scroll
      cv.dataset.ready = "true";
      box.dataset.live = "true";
    };

    const update = () => {
      ticking = false;
      const rect = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, -rect.top / (rect.height - innerHeight)));
      wanted = Math.round(Math.min(1, p / END_OF_MOTION) * (media.frames - 1));
      // The object starts on the right and comes to the middle as it opens, to make room for the callouts.
      const slide = Math.min(1, Math.max(0, (p - 0.58) / (END_OF_MOTION - 0.58)));
      box.style.setProperty("--slide", String(slide * slide * (3 - 2 * slide)));
      setStep(STEPS.filter((s) => p >= s).length);
      paint();
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    // Frames load after the page is usable: a coarse pass first, then the gaps.
    const order: number[] = [];
    for (const stride of [8, 4, 2, 1]) for (let i = 0; i < media.frames; i += stride) if (!order.includes(i)) order.push(i);
    let cancelled = false,
      next = 0;
    const loadMore = () => {
      if (cancelled || next >= order.length) return;
      const index = order[next++]!;
      const image = new Image();
      image.decoding = "async";
      // Decode ahead of time, off the main thread, so the first draw of a frame costs nothing.
      const ready = () => {
        paint();
        loadMore();
      };
      // A browser that cannot decode ahead of time still draws the frame; it only decodes at first draw instead.
      image.onload = () => {
        image.decode().then(ready, ready);
      };
      image.onerror = () => loadMore();
      image.src = `/media/seq/${width}/${String(index).padStart(3, "0")}.webp`;
      images[index] = image;
    };
    const begin = () => {
      for (let i = 0; i < 4; i++) loadMore();
    };
    const whenIdle = () => ("requestIdleCallback" in window ? requestIdleCallback(begin, { timeout: 1500 }) : setTimeout(begin, 400));
    if (document.readyState === "complete") whenIdle();
    else addEventListener("load", whenIdle, { once: true });

    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    update();
    return () => {
      cancelled = true;
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      removeEventListener("load", whenIdle);
    };
  }, []);

  return (
    <section className="seq" ref={section} data-bg-wide data-step={step}>
      <div className="stage">
        <div className="frame" ref={frameBox}>
          {/* The still is on screen from the first paint; the canvas takes over once frames arrive. */}
          <img
            src="/media/hero-1920.webp"
            srcSet={srcSet("hero")}
            sizes="(max-width: 760px) 180vw, 110vw"
            alt="A metal ring with a coin held in its centre"
            fetchPriority="high"
          />
          <canvas ref={canvas} aria-hidden="true" />
          <CalloutBoxes centre={site.objectX} />
        </div>
        <div className="words">
          <Glitch id={Math.min(step, 3)}>
            {step === 0 && (
              <>
                <h1 className="h1">
                  Launch in public.
                  <br />
                  Hold in the Ring.
                  <br />
                  Move it sealed.
                </h1>
                <Link className="btn" href="/launch">
                  Launch a coin
                </Link>
              </>
            )}
            {step === 1 && (
              <>
                <h2 className="h1">
                  One transfer.
                  <br />
                  Five layers.
                </h2>
                <p className="body">Every transfer between Ring balances is a single Solana transaction. Parts of it are public. Parts are encrypted.</p>
              </>
            )}
            {step === 2 && (
              <>
                <h2 className="h1">Take it apart.</h2>
                <p className="body">Your wallet and the chain are public. The coin, the amount and your balance are encrypted. Keep scrolling.</p>
              </>
            )}
            {step >= 3 && <h2 className="h2 how-title">How it works</h2>}
          </Glitch>
          {step === 4 && <CalloutList className="when-narrow" />}
        </div>
      </div>
    </section>
  );
}

/** The same story without motion: the hero, then the layers with their callouts. */
export function StillStory() {
  return (
    <div className="still" data-bg-wide>
      <section className="still-hero">
        <div className="words">
          <h1 className="h1">
            Launch in public.
            <br />
            Hold in the Ring.
            <br />
            Move it sealed.
          </h1>
          <Link className="btn" href="/launch">
            Launch a coin
          </Link>
        </div>
        <img src="/media/hero-1920.webp" srcSet={srcSet("hero")} sizes="110vw" alt="A metal ring with a coin held in its centre" />
      </section>
      <section className="still-how wrap">
        <h2 className="h2">How it works</h2>
        <div className="frame">
          <img src="/media/layers-1920.webp" srcSet={srcSet("layers")} sizes="100vw" loading="lazy" alt="The ring taken apart into five stacked layers" />
          <CalloutBoxes centre={0.5} />
        </div>
        <CalloutList className="when-narrow" />
      </section>
    </div>
  );
}
