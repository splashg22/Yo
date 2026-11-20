// The 3D ring of artwork on the home page and the option wheel in "One rule, every cycle".
// Plain ES module shared with the tests; no dependencies.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** How far round the ring a card is: 0 faces the viewer, 1 is at the back. */
export function depth(angleDeg) {
  const a = (((angleDeg % 360) + 360) % 360) * (Math.PI / 180);
  return (1 - Math.cos(a)) / 2;
}
/** Index of the card facing the viewer when the ring is rotated by `spin` degrees. */
export function frontIndex(spin, n) {
  const step = 360 / n;
  return ((Math.round(-spin / step) % n) + n) % n;
}
/** Position of an option `k` steps away from the selected one: items sit on an arc of radius 640 at 6° apart. */
export function wheelPose(k, radius = 640, stepDeg = 6) {
  const t = (k * stepDeg * Math.PI) / 180;
  const d = Math.abs(k);
  return { x: -radius * (1 - Math.cos(t)), y: radius * Math.sin(t), rot: k * stepDeg, opacity: Math.max(0.05, 1 - 0.25 * d), blur: 2 * d };
}
/** Digits of `value` padded to `width`, for the rolling counter. */
export const digits = (value, width = 2) => String(value).padStart(width, "0").split("").map(Number);

const reelHTML = (n) => `<span class="digit"><span class="reel" style="transform:translateY(${-n}em)">${Array.from({ length: 10 }, (_, d) => `<span>${d}</span>`).join("")}</span></span>`;
const mouseOnly = (fn) => (e) => { if (e.pointerType === "mouse") fn(e); };

/**
 * Builds a slowly turning cylinder of images inside `root`.
 * items: [{ src, alt, title, subtitle }]; `repeat` places the set round the ring more than once so a
 * handful of pictures still fill it. Drag or swipe to turn, arrow keys to step; auto-rotation pauses
 * while hovered or focused and stops for good once the keyboard has been used.
 */
export function ring(root, items, { width = 200, height = 266, gap = 44, tilt = -12, speed = 8, repeat = 2, reduced = reducedMotion() } = {}) {
  const cards = [];
  for (let r = 0; r < repeat; r++) for (let i = 0; i < items.length; i++) cards.push(i);
  const n = cards.length, m = items.length;
  const step = 360 / n;
  const radius = Math.round(((width + gap) * n) / (2 * Math.PI));
  const digitsWide = String(m).length;
  root.style.setProperty("--w", `${width}px`); root.style.setProperty("--h", `${height}px`);
  root.innerHTML = `<div class="ring-view"><div class="ring-camera" style="transform:translateY(${-Math.round(height * 0.16)}px) translateZ(${-radius}px) rotateX(${tilt}deg)"><div class="ring-spin">${cards
    .map((it, i) => `<div class="ring-card" aria-hidden="${i >= m}" style="transform:rotateY(${i * step}deg) translateZ(${radius}px)"><img src="${esc(items[it].src)}"${items[it].srcset ? ` srcset="${esc(items[it].srcset)}" sizes="${width}px"` : ""} alt="${esc(items[it].alt || items[it].title)}" width="${width}" height="${height}" loading="${i < 4 ? "eager" : "lazy"}" decoding="async" draggable="false"><div class="shade"></div></div>`)
    .join("")}</div></div></div><div class="ring-caption"><div class="ring-title"><b></b><span></span></div><div class="ring-count" aria-hidden="true"><span class="digits">${digits(1, digitsWide).map(reelHTML).join("")}</span><span class="slash">/</span><span>${m}</span></div><span class="sr-only" aria-live="polite"></span></div>`;
  const spinEl = root.querySelector(".ring-spin");
  const shades = [...root.querySelectorAll(".ring-card .shade")];
  const titleEl = root.querySelector(".ring-title");
  const live = root.querySelector(".sr-only");
  const reels = [...root.querySelectorAll(".digit .reel")];

  let spin = 0, velocity = 0, front = -1, last = null, raf = 0, dragging = false, idleUntil = 0, visible = true, hovered = false, focused = false, stopped = reduced;
  const caption = (card) => {
    const i = cards[card];
    if (i === front) return;
    front = i;
    titleEl.querySelector("b").textContent = items[i].title;
    titleEl.querySelector("span").textContent = items[i].subtitle || "";
    titleEl.classList.remove("swap"); void titleEl.offsetWidth; titleEl.classList.add("swap");
    digits(i + 1, digitsWide).forEach((d, k) => { reels[k].style.transform = `translateY(${-d}em)`; });
    live.textContent = `${items[i].title}, ${i + 1} of ${m}`;
  };
  const paint = () => {
    spinEl.style.transform = `rotateY(${spin.toFixed(2)}deg)`;
    for (let i = 0; i < n; i++) shades[i].style.opacity = (depth(i * step + spin) * 0.88).toFixed(2);
    caption(frontIndex(spin, n));
  };
  const frame = (t) => {
    if (last != null && visible) {
      const dt = Math.min(0.05, (t - last) / 1000);
      if (!dragging) {
        if (Math.abs(velocity) > 0.5) { spin += velocity * dt; velocity *= Math.pow(0.08, dt); paint(); }
        else if (!stopped && !hovered && !focused && t > idleUntil) { spin -= speed * dt; paint(); }
      }
    }
    last = t;
    raf = requestAnimationFrame(frame);
  };

  // Drag or swipe to turn.
  let px = 0, pt = 0;
  const onDown = (e) => { if (e.button !== 0) return; dragging = true; velocity = 0; px = e.clientX; pt = e.timeStamp; root.setAttribute("data-dragging", ""); root.setPointerCapture(e.pointerId); };
  const onMove = (e) => { if (!dragging) return; const dx = e.clientX - px, dt = Math.max(1, e.timeStamp - pt); spin += dx * 0.28; velocity = (dx * 0.28) / (dt / 1000); px = e.clientX; pt = e.timeStamp; paint(); };
  const release = () => { if (!dragging) return; dragging = false; root.removeAttribute("data-dragging"); idleUntil = performance.now() + 3500; };
  const onKey = (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); velocity = 0; spin += e.key === "ArrowRight" ? -step : step; stopped = true; paint(); } };
  const onEnter = mouseOnly(() => { hovered = true; }), onLeave = mouseOnly(() => { hovered = false; idleUntil = performance.now() + 1000; });
  const onFocus = () => { focused = true; }, onBlur = () => { focused = false; };
  const onVis = () => { last = null; };
  root.addEventListener("pointerdown", onDown); root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", release); root.addEventListener("pointercancel", release);
  root.addEventListener("keydown", onKey);
  root.addEventListener("pointerenter", onEnter); root.addEventListener("pointerleave", onLeave);
  root.addEventListener("focusin", onFocus); root.addEventListener("focusout", onBlur);
  document.addEventListener("visibilitychange", onVis);
  const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => { visible = e.isIntersecting; })) : null;
  io?.observe(root);
  paint();
  raf = requestAnimationFrame(frame);
  return {
    goTo(i) { spin = -i * step; velocity = 0; paint(); },
    destroy() {
      cancelAnimationFrame(raf); io?.disconnect(); document.removeEventListener("visibilitychange", onVis);
      for (const [ev, fn] of [["pointerdown", onDown], ["pointermove", onMove], ["pointerup", release], ["pointercancel", release], ["keydown", onKey], ["pointerenter", onEnter], ["pointerleave", onLeave], ["focusin", onFocus], ["focusout", onBlur]]) root.removeEventListener(ev, fn);
      root.innerHTML = "";
    },
  };
}

/**
 * A vertical option wheel: the selected label is bold and sharp, the others fall away along an arc.
 * labels: string[]; onSelect(index) runs on every change. Click, arrow keys, or the mouse wheel once the
 * wheel has focus, move it; it advances on its own every `interval` ms until the visitor touches it.
 */
export function wheel(root, labels, { onSelect = () => {}, interval = 4500, reduced = reducedMotion() } = {}) {
  const id = root.id || "wheel";
  root.innerHTML = `<div class="wheel-track">${labels.map((l, i) => `<div class="wheel-item" id="${id}-opt-${i}" role="option" aria-selected="false">${esc(l)}</div>`).join("")}</div>`;
  const items = [...root.querySelectorAll(".wheel-item")];
  let sel = 0, timer = 0, touched = reduced, hovering = false, visible = true, wheelLock = 0;
  const paint = () => {
    items.forEach((el, i) => {
      const p = wheelPose(i - sel);
      el.style.transform = `translate(${p.x.toFixed(2)}px, calc(-50% + ${p.y.toFixed(2)}px)) rotate(${p.rot}deg)`;
      el.style.opacity = p.opacity.toFixed(2);
      el.style.filter = p.blur ? `blur(${p.blur}px)` : "none";
      el.classList.toggle("is-selected", i === sel);
      el.setAttribute("aria-selected", String(i === sel));
    });
    root.setAttribute("aria-activedescendant", items[sel].id);
    onSelect(sel);
  };
  const select = (i, byUser = true) => { sel = ((i % labels.length) + labels.length) % labels.length; if (byUser) touched = true; paint(); };
  const tick = () => { if (visible && !touched && !hovering) select(sel + 1, false); };
  const onClick = (e) => { const el = e.target.closest(".wheel-item"); if (el) select(items.indexOf(el)); };
  const onKey = (e) => { if (e.key === "ArrowDown") { e.preventDefault(); select(sel + 1); } if (e.key === "ArrowUp") { e.preventDefault(); select(sel - 1); } };
  const onWheel = (e) => { if (!root.matches(":focus-within") || Math.abs(e.deltaY) < 4) return; e.preventDefault(); const now = performance.now(); if (now < wheelLock) return; wheelLock = now + 450; select(sel + (e.deltaY > 0 ? 1 : -1)); };
  const onEnter = mouseOnly(() => { hovering = true; }), onLeave = mouseOnly(() => { hovering = false; });
  root.addEventListener("click", onClick); root.addEventListener("keydown", onKey);
  root.addEventListener("wheel", onWheel, { passive: false });
  root.addEventListener("pointerenter", onEnter); root.addEventListener("pointerleave", onLeave);
  const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => { visible = e.isIntersecting; })) : null;
  io?.observe(root);
  paint();
  if (!reduced) timer = setInterval(tick, interval);
  return {
    select, get index() { return sel; },
    destroy() {
      clearInterval(timer); io?.disconnect();
      root.removeEventListener("click", onClick); root.removeEventListener("keydown", onKey); root.removeEventListener("wheel", onWheel);
      root.removeEventListener("pointerenter", onEnter); root.removeEventListener("pointerleave", onLeave);
      root.removeAttribute("aria-activedescendant"); root.innerHTML = "";
    },
  };
}
