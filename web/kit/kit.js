/**
 * The kit's behaviour: the components the sites are built from, written here
 * rather than taken from a UI library.
 *
 *   <kit-avatar seed text>    initials on a colour picked from the seed
 *   <kit-select value label>  a listbox; options are its <option> children
 *   <kit-seg label>           tabs with a sliding underline
 *   <kit-acc>                 <details> that open and close smoothly
 *   <kit-copy value label>    an address with a copy button
 *   <kit-drop hint>           a picture well around an <input type="file">
 *   <kit-theme>               the light / dark switch
 *   <i data-ic="name">        an icon, written into a page
 *   <input data-count="id">   a character counter, shown in the element with that id
 *   icon(name), toast(text)   helpers
 *
 * Everything renders in the light DOM and is styled by kit.css. Importing this
 * file outside a browser defines nothing and is harmless.
 */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---- Icons: one hand, round strokes on a 24 grid -------------------------
const ICONS = {
  right: "M4 12h15M13 6l6 6-6 6",
  out: "M7 17 17 7M9 7h8v8",
  down: "M5 9l7 7 7-7",
  check: "M4 12.5l5 5L20 6.5",
  close: "M6 6l12 12M18 6 6 18",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20",
  up: "M12 19V5M6 11l6-6 6 6",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
  flame: "M12 21c-3.9 0-6.5-2.6-6.5-6.1 0-2.6 1.6-4.3 3-5.9 1.3-1.5 2.4-3 2.2-6 3.6 1.7 7.8 5.6 7.8 11.4 0 3.9-2.6 6.6-6.5 6.6z",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01",
  alert: "M12 3 2.5 20h19L12 3zM12 10v5M12 17.5h.01",
  wallet: "M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7zM4 7V6a2 2 0 0 1 2-2h10v3M16 13.5h.01",
};

/** An icon as an SVG string, for use inside markup. */
export const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ""}"/></svg>`;

// ---- Toasts -----------------------------------------------------------------------

/** Says one short thing at the bottom of the screen, then goes away. */
export function toast(text, ms = 2600) {
  if (typeof document === "undefined") return;
  let box = document.querySelector(".toasts");
  if (!box) {
    box = document.createElement("div");
    box.className = "toasts";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    document.body.append(box);
  }
  const item = document.createElement("div");
  item.className = "toast";
  item.innerHTML = `${icon("check")}<span>${esc(text)}</span>`;
  box.append(item);
  setTimeout(() => { item.classList.add("out"); setTimeout(() => item.remove(), 300); }, ms);
}

/** A small, stable number from any text (FNV-1a), so the same name always gets the same colour. */
export function seedOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** The hue of an avatar, from what it stands for. The greens are left out: green means "available" here. */
export const hueOf = (seed) => { const h = seedOf(seed) % 260; return h < 70 ? h : h + 100; };

if (typeof customElements !== "undefined") {
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const define = (name, element) => { if (!customElements.get(name)) customElements.define(name, element); };

  // ---- <kit-avatar> -----------------------------------------------------------------
  define("kit-avatar", class extends HTMLElement {
    static observedAttributes = ["seed", "text"];
    connectedCallback() { this.draw(); }
    attributeChangedCallback() { if (this.isConnected) this.draw(); }
    draw() {
      const text = (this.getAttribute("text") || "").slice(0, 2).toUpperCase();
      this.style.setProperty("--h", String(hueOf(this.getAttribute("seed") || text)));
      this.setAttribute("aria-hidden", "true");
      this.innerHTML = `<span>${esc(text)}</span>`;
    }
  });

  // ---- <kit-select> -----------------------------------------------------------------
  define("kit-select", class extends HTMLElement {
    connectedCallback() {
      if (this.button) return;
      this.options = [...this.querySelectorAll("option")].map((o) => ({ value: o.value, label: o.textContent.trim() }));
      const id = this.id || `sel-${Math.random().toString(36).slice(2, 8)}`;
      this.innerHTML = `<button type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(this.getAttribute("label") || "")}"><span></span>${icon("down")}</button>
        <ul role="listbox" tabindex="-1" hidden aria-label="${esc(this.getAttribute("label") || "")}">${this.options.map((o, i) => `<li role="option" id="${id}-o${i}" data-i="${i}" aria-selected="false"><span>${esc(o.label)}</span>${icon("check")}</li>`).join("")}</ul>`;
      this.button = this.querySelector("button");
      this.list = this.querySelector("ul");
      this.items = [...this.list.children];
      this.at = 0;
      this.typed = "";
      this.paint();
      this.button.addEventListener("click", () => (this.list.hidden ? this.open() : this.close()));
      this.button.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); this.open(); } });
      this.list.addEventListener("click", (e) => { const li = e.target.closest("[role=option]"); if (li) this.choose(Number(li.dataset.i)); });
      this.list.addEventListener("pointermove", (e) => { const li = e.target.closest("[role=option]"); if (li) this.move(Number(li.dataset.i)); });
      this.list.addEventListener("keydown", (e) => this.key(e));
      this.list.addEventListener("focusout", (e) => { if (!this.contains(e.relatedTarget)) this.close(false); });
    }
    get value() { return this.getAttribute("value") || (this.options[0] && this.options[0].value) || ""; }
    set value(v) { this.setAttribute("value", v); if (this.button) this.paint(); }
    paint() {
      const index = Math.max(0, this.options.findIndex((o) => o.value === this.value));
      this.button.firstElementChild.textContent = this.options[index] ? this.options[index].label : "";
      this.items.forEach((li, i) => li.setAttribute("aria-selected", String(i === index)));
      return index;
    }
    move(i) {
      this.at = (i + this.items.length) % this.items.length;
      this.items.forEach((li, n) => li.classList.toggle("at", n === this.at));
      this.list.setAttribute("aria-activedescendant", this.items[this.at].id);
    }
    open() {
      this.list.hidden = false;
      this.button.setAttribute("aria-expanded", "true");
      this.move(this.paint());
      this.list.focus();
    }
    close(refocus = true) {
      if (this.list.hidden) return;
      this.list.hidden = true;
      this.button.setAttribute("aria-expanded", "false");
      if (refocus) this.button.focus();
    }
    choose(i) {
      const changed = this.options[i].value !== this.value;
      this.setAttribute("value", this.options[i].value);
      this.paint();
      this.close();
      if (changed) this.dispatchEvent(new Event("change", { bubbles: true }));
    }
    key(e) {
      if (e.key === "ArrowDown") { e.preventDefault(); this.move(this.at + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); this.move(this.at - 1); }
      else if (e.key === "Home") { e.preventDefault(); this.move(0); }
      else if (e.key === "End") { e.preventDefault(); this.move(this.items.length - 1); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.choose(this.at); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); }
      else if (e.key === "Tab") this.close(false);
      else if (e.key.length === 1) {
        // Type a letter or two to jump to an option.
        this.typed += e.key.toLowerCase();
        clearTimeout(this.typing);
        this.typing = setTimeout(() => { this.typed = ""; }, 600);
        const hit = this.options.findIndex((o) => o.label.toLowerCase().startsWith(this.typed));
        if (hit >= 0) this.move(hit);
      }
    }
  });

  // ---- <kit-seg> --------------------------------------------------------------------
  define("kit-seg", class extends HTMLElement {
    connectedCallback() {
      if (this.thumb) return;
      this.setAttribute("role", "group");
      if (this.getAttribute("label")) this.setAttribute("aria-label", this.getAttribute("label"));
      this.thumb = document.createElement("span");
      this.thumb.className = "thumb";
      this.thumb.setAttribute("aria-hidden", "true");
      this.append(this.thumb);
      this.shown = "";
      this.addEventListener("click", (e) => { const b = e.target.closest("button[data-v]"); if (b) this.pick(b.dataset.v, true); });
      this.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const buttons = [...this.querySelectorAll("button")];
        const next = buttons[(buttons.indexOf(document.activeElement) + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
        if (next) { e.preventDefault(); next.focus(); this.pick(next.dataset.v, true); }
      });
      if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => this.slide(false)).observe(this);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.slide(false));
      if (this.pending) { const p = this.pending; this.pending = null; this.set(p.options, p.value); }
    }
    get value() { return this.getAttribute("value") || ""; }
    /** The choices and the chosen one: [{ value, label, count? }]. Safe to call on every render. */
    set(options, value) {
      if (!this.thumb) { this.pending = { options, value }; return; }
      const shape = JSON.stringify(options);
      if (shape !== this.shown) {
        const focused = this.contains(document.activeElement) ? document.activeElement.dataset.v : null;
        for (const b of this.querySelectorAll("button")) b.remove();
        for (const o of options) {
          const b = document.createElement("button");
          b.type = "button";
          b.dataset.v = o.value;
          b.innerHTML = `${esc(o.label)}${o.count === undefined ? "" : `<small>${esc(o.count)}</small>`}`;
          this.append(b);
        }
        this.shown = shape;
        if (focused !== null) { const again = [...this.querySelectorAll("button")].find((b) => b.dataset.v === focused); if (again) again.focus(); }
      }
      this.pick(value, false);
    }
    pick(value, fromUser) {
      const changed = value !== this.value;
      this.setAttribute("value", value);
      for (const b of this.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.v === value));
      this.slide(fromUser);
      if (fromUser && changed) this.dispatchEvent(new Event("change", { bubbles: true }));
    }
    slide(animate) {
      const on = this.querySelector('button[aria-pressed="true"]');
      if (!on || !this.thumb) return;
      if (!animate) this.thumb.style.transition = "none";
      this.thumb.style.width = `${on.offsetWidth}px`;
      this.thumb.style.transform = `translateX(${on.offsetLeft}px)`;
      if (!animate) { void this.thumb.offsetWidth; this.thumb.style.transition = ""; }
    }
  });

  // ---- <kit-acc> --------------------------------------------------------------------
  define("kit-acc", class extends HTMLElement {
    connectedCallback() {
      if (this.ready) return;
      this.ready = true;
      for (const details of this.querySelectorAll("details")) {
        const summary = details.querySelector("summary");
        const body = document.createElement("div");
        body.className = "acc-body";
        body.append(...[...details.childNodes].filter((n) => n !== summary));
        details.append(body);
        summary.addEventListener("click", (event) => {
          if (still() || !body.animate) return; // the browser's own open and close is fine
          event.preventDefault();
          if (details.dataset.moving) return;
          details.dataset.moving = "1";
          const opening = !details.open;
          if (opening) details.open = true;
          const height = body.scrollHeight;
          const run = body.animate({ height: opening ? ["0px", `${height}px`] : [`${height}px`, "0px"] }, { duration: 220, easing: "cubic-bezier(0.3, 0.8, 0.3, 1)" });
          run.onfinish = run.oncancel = () => { if (!opening) details.open = false; delete details.dataset.moving; };
        });
      }
    }
  });

  // ---- <kit-copy> -------------------------------------------------------------------
  define("kit-copy", class extends HTMLElement {
    connectedCallback() {
      if (this.code) return;
      const value = this.getAttribute("value") || "";
      const what = this.getAttribute("label") || "address";
      const shown = value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
      this.innerHTML = `<code title="${esc(value)}">${esc(shown)}</code><button type="button" aria-label="Copy the ${esc(what)}">${icon("copy")}</button>`;
      this.code = this.querySelector("code");
      const button = this.querySelector("button");
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(value);
          this.setAttribute("done", "");
          button.innerHTML = icon("check");
          toast(`${what[0].toUpperCase()}${what.slice(1)} copied`);
          setTimeout(() => { this.removeAttribute("done"); button.innerHTML = icon("copy"); }, 1800);
        } catch {
          // No clipboard here: show all of it, selected, so it can be copied by hand.
          this.code.textContent = value;
          getSelection().selectAllChildren(this.code);
          toast("Selected. Copy it with your keyboard or the menu");
        }
      });
    }
  });

  // ---- <kit-drop> -------------------------------------------------------------------
  define("kit-drop", class extends HTMLElement {
    connectedCallback() {
      if (this.input) return;
      this.input = this.querySelector('input[type="file"]');
      if (!this.input) return;
      const hint = this.getAttribute("hint") || "";
      this.insertAdjacentHTML("afterbegin", `<span class="th">${icon("image")}</span><span class="tx"><b>Upload a picture</b><span>${esc(hint)}</span></span>`);
      this.insertAdjacentHTML("beforeend", `<button type="button" class="textbtn rm" hidden>Remove</button>`);
      this.thumb = this.querySelector(".th");
      this.heading = this.querySelector(".tx b");
      this.note = this.querySelector(".tx span");
      this.remove_ = this.querySelector(".rm");
      this.input.addEventListener("change", () => this.paint());
      this.remove_.addEventListener("click", () => { this.input.value = ""; this.input.dispatchEvent(new Event("change", { bubbles: true })); this.input.focus(); });
      for (const type of ["dragenter", "dragover"]) this.addEventListener(type, (e) => { e.preventDefault(); this.classList.add("over"); });
      for (const type of ["dragleave", "drop"]) this.addEventListener(type, () => this.classList.remove("over"));
      this.addEventListener("drop", (e) => {
        e.preventDefault();
        if (!e.dataTransfer || !e.dataTransfer.files.length) return;
        try { this.input.files = e.dataTransfer.files; } catch { return; }
        this.input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    paint() {
      const file = this.input.files[0];
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = file ? URL.createObjectURL(file) : "";
      this.thumb.innerHTML = file ? `<img alt="" src="${this.url}">` : icon("image");
      this.heading.textContent = file ? file.name : "Upload a picture";
      this.note.textContent = file ? `${file.size >= 1e6 ? `${(file.size / 1e6).toFixed(2)} MB` : `${Math.max(1, Math.round(file.size / 1e3))} KB`} · click to change` : this.getAttribute("hint") || "";
      this.remove_.hidden = !file;
    }
  });

  // ---- <kit-theme> ------------------------------------------------------------------
  define("kit-theme", class extends HTMLElement {
    connectedCallback() {
      if (this.button) return;
      this.innerHTML = `<button type="button" class="iconbtn"></button>`;
      this.button = this.firstElementChild;
      try { const saved = localStorage.getItem("kit:theme"); if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved; } catch { /* no storage here */ }
      this.button.addEventListener("click", () => {
        const next = this.dark() ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem("kit:theme", next); } catch { /* no storage here */ }
        this.paint();
      });
      this.paint();
      // Whoever shows this page may set the theme too; follow it.
      new MutationObserver(() => this.paint()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.paint());
    }
    dark() {
      const set = document.documentElement.dataset.theme;
      return set ? set === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    }
    paint() {
      const dark = this.dark();
      this.button.innerHTML = icon(dark ? "sun" : "moon");
      this.button.setAttribute("aria-label", dark ? "Switch to the light theme" : "Switch to the dark theme");
    }
  });

  // ---- Character counters: <input data-count="f-name-ct"> ---------------------------
  const count = (input) => {
    const out = document.getElementById(input.dataset.count);
    if (out) out.textContent = `${input.value.length}/${input.maxLength}`;
  };
  const wire = () => {
    for (const input of document.querySelectorAll("[data-count]")) { count(input); input.addEventListener("input", () => count(input)); }
    // Icons written into a page as <i data-ic="name"></i>
    for (const mark of document.querySelectorAll("i[data-ic]")) mark.outerHTML = icon(mark.dataset.ic);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire); else wire();
}
