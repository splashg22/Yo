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

/**
 * Builds a slowly turning cylinder of square images inside `root`.
 * items: [{ src, alt, title, subtitle }]. Drag to turn, arrows to step; it resumes on its own.
 */
export function ring(root, items, { size = 220, gap = 34, tilt = -5, speed = 9, reduced = reducedMotion() } = {}) {
  const n = items.length;
  const step = 360 / n;
  const radius = Math.round(((size + gap) * n) / (2 * Math.PI));
  root.style.setProperty("--size", `${size}px`);
  root.innerHTML = `<div class="ring-view"><div class="ring-camera" style="transform:translateY(${-Math.round(size * 0.2)}px) translateZ(${-radius}px) rotateX(${tilt}deg)"><div class="ring-spin">${items
    .map((it, i) => `<div class="ring-card" role="group" aria-roledescription="slide" aria-label="${esc(it.title)}, ${i + 1} of ${n}" style="transform:rotateY(${i * step}deg) translateZ(${radius}px)"><img src="${esc(it.src)}" alt="${esc(it.alt || it.title)}" loading="${i < 4 ? "eager" : "lazy"}" draggable="false"><div class="shade"></div></div>`)
    .join("")}</div></div></div><div class="ring-caption"><div class="ring-title"><b></b><span></span></div><div class="ring-count"><span class="digits">${digits(1).map(reelHTML).join("")}</span><span class="slash">/</span><span>${String(n).padStart(2, "0")}</span></div></div>`;
  const spinEl = root.querySelector(".ring-spin");
  const cards = [...root.querySelectorAll(".ring-card")];
  const shades = cards.map((c) => c.querySelector(".shade"));
  const titleEl = root.querySelector(".ring-title");
  const reels = [...root.querySelectorAll(".digit .reel")];

  let spin = 0, velocity = 0, front = -1, last = null, raf = 0, dragging = false, idleUntil = 0, visible = true;
  const caption = (i) => {
    if (i === front) return;
    front = i;
    titleEl.querySelector("b").textContent = items[i].title;
    titleEl.querySelector("span").textContent = items[i].subtitle || "";
    titleEl.classList.remove("swap"); void titleEl.offsetWidth; titleEl.classList.add("swap");
    digits(i + 1).forEach((d, k) => { reels[k].style.transform = `translateY(${-d}em)`; });
  };
  const paint = () => {
    spinEl.style.transform = `rotateY(${spin}deg)`;
    for (let i = 0; i < n; i++) shades[i].style.opacity = (depth(i * step + spin) * 0.88).toFixed(3);
    caption(frontIndex(spin, n));
  };
  const frame = (t) => {
    if (last != null && visible) {
      const dt = Math.min(0.05, (t - last) / 1000);
      if (!dragging) {
        if (Math.abs(velocity) > 0.5) { spin += velocity * dt; velocity *= Math.pow(0.08, dt); }
        else if (!reduced && t > idleUntil) spin -= speed * dt;
      }
      paint();
    }
    last = t;
    raf = requestAnimationFrame(frame);
  };

  // Drag to turn.
  let px = 0, pt = 0;
  root.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; dragging = true; velocity = 0; px = e.clientX; pt = e.timeStamp; root.setAttribute("data-dragging", ""); root.setPointerCapture(e.pointerId); });
  root.addEventListener("pointermove", (e) => { if (!dragging) return; const dx = e.clientX - px, dt = Math.max(1, e.timeStamp - pt); spin += dx * 0.28; velocity = (dx * 0.28) / (dt / 1000); px = e.clientX; pt = e.timeStamp; });
  const release = () => { if (!dragging) return; dragging = false; root.removeAttribute("data-dragging"); idleUntil = performance.now() + 3500; };
  root.addEventListener("pointerup", release); root.addEventListener("pointercancel", release);
  root.addEventListener("keydown", (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); velocity = 0; spin += e.key === "ArrowRight" ? -step : step; idleUntil = performance.now() + 5000; } });
  root.addEventListener("mouseenter", () => { idleUntil = Infinity; });
  root.addEventListener("mouseleave", () => { idleUntil = performance.now() + 1200; });

  if ("IntersectionObserver" in window) new IntersectionObserver((es) => es.forEach((e) => { visible = e.isIntersecting; })).observe(root);
  document.addEventListener("visibilitychange", () => { last = null; });
  paint();
  raf = requestAnimationFrame(frame);
  return { goTo(i) { spin = -i * step; velocity = 0; paint(); }, destroy() { cancelAnimationFrame(raf); } };
}

/**
 * A vertical option wheel: the selected label is bold and sharp, the others fall away along an arc.
 * labels: string[]; onSelect(index) runs on every change. Click, arrow keys or the mouse wheel to move;
 * it advances on its own every `interval` ms until the visitor touches it.
 */
export function wheel(root, labels, { onSelect = () => {}, interval = 4500, reduced = reducedMotion() } = {}) {
  root.innerHTML = labels.map((l) => `<div class="wheel-item" role="option" aria-selected="false">${esc(l)}</div>`).join("");
  const items = [...root.children];
  let sel = 0, timer = 0, touched = false, visible = true;
  const paint = () => {
    items.forEach((el, i) => {
      const p = wheelPose(i - sel);
      el.style.transform = `translate(${p.x.toFixed(2)}px, calc(-50% + ${p.y.toFixed(2)}px)) rotate(${p.rot}deg)`;
      el.style.opacity = p.opacity.toFixed(2);
      el.style.filter = p.blur ? `blur(${p.blur}px)` : "none";
      el.classList.toggle("is-selected", i === sel);
      el.setAttribute("aria-selected", String(i === sel));
    });
    onSelect(sel);
  };
  const select = (i, byUser = true) => { sel = ((i % labels.length) + labels.length) % labels.length; if (byUser) touched = true; paint(); if (byUser) schedule(); };
  const schedule = () => { clearInterval(timer); if (reduced) return; timer = setInterval(() => { if (visible && !touched) select(sel + 1, false); }, interval); };
  items.forEach((el, i) => el.addEventListener("click", () => select(i)));
  root.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); select(sel + 1); } if (e.key === "ArrowUp") { e.preventDefault(); select(sel - 1); } });
  let wheelLock = 0;
  root.addEventListener("wheel", (e) => { if (Math.abs(e.deltaY) < 4) return; e.preventDefault(); const now = performance.now(); if (now < wheelLock) return; wheelLock = now + 450; select(sel + (e.deltaY > 0 ? 1 : -1)); }, { passive: false });
  root.addEventListener("pointerenter", () => { touched = true; });
  root.addEventListener("pointerleave", () => { touched = false; });
  if ("IntersectionObserver" in window) new IntersectionObserver((es) => es.forEach((e) => { visible = e.isIntersecting; })).observe(root);
  paint();
  schedule();
  return { select, get index() { return sel; } };
}
