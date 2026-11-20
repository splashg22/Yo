/**
 * Motion helpers for the proof pages: section reveals and metric count-ups.
 * Pure functions are exported so they can be unit-tested; the DOM wiring is
 * in `reveal()` and `countUp()`. Everything respects prefers-reduced-motion.
 */

/** Ease-out cubic, 0..1 -> 0..1. */
export function easeOut(t) {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

/**
 * Splits a formatted number such as "1,234.56" into the digits to tween and
 * the exact text to end on. Returns null when the text has no number in it.
 */
export function parseAmount(text) {
  const m = String(text).match(/-?[\d,]*\.?\d+/);
  if (!m) return null;
  const digits = m[0];
  const value = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
  return { prefix: text.slice(0, m.index), suffix: text.slice(m.index + digits.length), value, decimals, grouped: digits.includes(",") };
}

/** The text to show at progress `t` (0..1) of a count-up from 0 to the parsed amount. */
export function frameText(parsed, t) {
  const v = parsed.value * easeOut(t);
  let s = v.toFixed(parsed.decimals);
  if (parsed.grouped) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${parsed.prefix}${s}${parsed.suffix}`;
}

export const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Animates the number inside `el` from 0 to its current text, once, in ~700ms.
 * Runs only when the text actually changed since the last call (tracked on the
 * element), so re-renders with the same value do nothing. Skips under reduced motion.
 */
export function countUp(el, duration = 700) {
  const target = el.textContent;
  if (el.dataset.shown === target) return;
  el.dataset.shown = target;
  const parsed = parseAmount(target);
  if (!parsed || parsed.value === 0 || reducedMotion()) return;
  const start = performance.now();
  const tick = (now) => {
    const t = (now - start) / duration;
    el.textContent = t >= 1 ? target : frameText(parsed, t);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Adds .in to every `.reveal` element as it enters the viewport, once. */
export function reveal(root = document) {
  const els = [...root.querySelectorAll(".reveal")];
  if (!els.length) return;
  if (reducedMotion() || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
  els.forEach((e) => io.observe(e));
}
