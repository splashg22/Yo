// Composes the music bed and the sound effects for the walkthrough from plain oscillators, noise and
// envelopes. No samples, no third-party audio code: the result belongs to this project outright.
//   node audio/synth.mjs   → public/audio/bed.wav and public/audio/sfx-*.wav (48 kHz, 24-bit, stereo)
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LP, SR, adsr, db, midi, rng, writeWav } from "./wav.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "public", "audio");

const BPM = 100, BEAT = 60 / BPM, BAR = BEAT * 4, LEN = 28.8; // 12 bars; the cuts fall on beats
const N = Math.round(LEN * SR);
const saw = (p) => 2 * (p - Math.floor(p + 0.5));
const tri = (p) => 1 - 4 * Math.abs(Math.round(p - 0.25) - (p - 0.25));
const sqr = (p) => (p - Math.floor(p) < 0.5 ? 1 : -1);
/** Piecewise-linear automation: value at t for points [[t, v], ...]. */
const ramp = (t, pts) => {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [t0, v0] = pts[i - 1], [t1, v1] = pts[i]; return v0 + (v1 - v0) * ((t - t0) / (t1 - t0)); }
  return pts[pts.length - 1][1];
};

// ---- The bed -------------------------------------------------------------------------------------------
// A minor, four bars looping: Am · F · C · G. 100 BPM, 28.8 s (12 bars), fades out on the end card.
const CHORDS = [
  { pad: [57, 60, 64], bass: 33 }, // A minor
  { pad: [53, 57, 60], bass: 29 }, // F
  { pad: [55, 60, 64], bass: 36 }, // C
  { pad: [55, 59, 62], bass: 31 }, // G
];
const chordAt = (bar) => CHORDS[bar % 4];
// Scene-shaped arrangement (seconds): intro → problem → reveal → full → end card.
const A = {
  pad:    (t) => ramp(t, [[0, 0.55], [3.6, 0.8], [8.4, 1], [21.6, 1], [25.6, 1], [28.4, 0]]),
  bass:   (t) => ramp(t, [[0, 0], [3.4, 0], [3.8, 0.85], [14.4, 1], [25.6, 1], [28.4, 0]]),
  kick:   (t) => ramp(t, [[0, 0.5], [3.6, 0.8], [14.4, 1], [21.6, 0.7], [25.6, 0.7], [28.4, 0]]),
  hat:    (t) => ramp(t, [[0, 0], [8.2, 0], [8.6, 0.7], [14.4, 1], [21.6, 0.5], [24.0, 0]]),
  arp:    (t) => ramp(t, [[0, 0], [8.2, 0], [8.8, 0.6], [14.4, 1], [21.6, 0.8], [23.6, 0]]),
  master: (t) => ramp(t, [[0, 0], [0.4, 1], [25.6, 1], [28.5, 0]]),
};

function bed() {
  const L = new Float32Array(N), R = new Float32Array(N);
  const add = (i, l, r) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } };

  // Pad: two detuned saws per note, slow attack, low-passed, panned by detune.
  for (let bar = 0; bar * BAR < LEN; bar++) {
    const t0 = bar * BAR, c = chordAt(bar);
    for (const note of c.pad) {
      for (const [cents, pan] of [[-7, -0.5], [7, 0.5]]) {
        const f = midi(note) * 2 ** (cents / 1200);
        const lp = new LP(900);
        let ph = 0;
        const from = Math.floor(t0 * SR), to = Math.min(N, Math.floor((t0 + BAR + 1.1) * SR));
        for (let i = from; i < to; i++) {
          const t = i / SR - t0;
          const env = adsr(t, BAR, 0.7, 0.3, 0.85, 1.0);
          if (env <= 0) continue;
          ph += f / SR;
          lp.set(600 + 700 * env);
          const v = lp.run(saw(ph)) * env * 0.045 * A.pad(i / SR);
          add(i, v * (1 - pan) * 0.5 + v * 0.5, v * (1 + pan) * 0.5 + v * 0.5);
        }
      }
    }
  }

  // Bass: eighth-note pulse on the root, saw + sine, low-passed, accented on the beat.
  for (let k = 0; k * BEAT / 2 < LEN; k++) {
    const t0 = k * BEAT / 2, bar = Math.floor(t0 / BAR), c = chordAt(bar);
    const f = midi(c.bass), accent = k % 2 === 0 ? 1 : 0.72;
    const lp = new LP(380);
    let ph = 0;
    const from = Math.floor(t0 * SR), to = Math.min(N, Math.floor((t0 + BEAT / 2 + 0.05) * SR));
    for (let i = from; i < to; i++) {
      const t = i / SR - t0;
      const env = adsr(t, BEAT / 2 - 0.02, 0.004, 0.22, 0.35, 0.04);
      if (env <= 0) continue;
      ph += f / SR;
      lp.set(200 + 420 * env);
      const v = (lp.run(saw(ph)) * 0.8 + Math.sin(2 * Math.PI * ph) * 0.5) * env * 0.17 * accent * A.bass(i / SR);
      add(i, v, v);
    }
  }

  // Kick: a sine that drops from 110 to 42 Hz, every beat.
  for (let b = 0; b * BEAT < LEN; b++) {
    const t0 = b * BEAT;
    let ph = 0;
    const from = Math.floor(t0 * SR), to = Math.min(N, Math.floor((t0 + 0.5) * SR));
    for (let i = from; i < to; i++) {
      const t = i / SR - t0;
      const f = 42 + 68 * Math.exp(-t / 0.045);
      ph += f / SR;
      const v = Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.13) * Math.min(1, t / 0.002) * 0.34 * A.kick(i / SR);
      add(i, v, v);
    }
  }

  // Hat: a short high-passed noise burst on the off-beats.
  const noise = rng(7);
  for (let k = 1; k * BEAT / 2 < LEN; k += 2) {
    const t0 = k * BEAT / 2;
    const lp = new LP(6000);
    const from = Math.floor(t0 * SR), to = Math.min(N, Math.floor((t0 + 0.08) * SR));
    for (let i = from; i < to; i++) {
      const t = i / SR - t0;
      const x = noise();
      const v = (x - lp.run(x)) * Math.exp(-t / 0.022) * 0.05 * A.hat(i / SR);
      add(i, v * 0.9, v * 1.1);
    }
  }

  // Arpeggio: sixteenth plucks over the chord tones, with a ping-pong delay for width.
  const arpL = new Float32Array(N), arpR = new Float32Array(N);
  const pattern = [0, 1, 2, 3, 2, 1, 4, 3];
  for (let k = 0; k * BEAT / 4 < LEN; k++) {
    const t0 = k * BEAT / 4, bar = Math.floor(t0 / BAR), c = chordAt(bar);
    const tones = [c.pad[0] + 12, c.pad[1] + 12, c.pad[2] + 12, c.pad[0] + 24, c.pad[1] + 24];
    const f = midi(tones[pattern[k % pattern.length]]);
    const lp = new LP(2600);
    let ph = 0;
    const from = Math.floor(t0 * SR), to = Math.min(N, Math.floor((t0 + 0.4) * SR));
    for (let i = from; i < to; i++) {
      const t = i / SR - t0;
      ph += f / SR;
      const env = Math.exp(-t / 0.09) * Math.min(1, t / 0.002);
      const v = lp.run(tri(ph) + 0.25 * sqr(ph)) * env * 0.075 * A.arp(i / SR);
      arpL[i] += v; arpR[i] += v;
    }
  }
  const D = Math.round(BEAT * 0.75 * SR); // dotted eighth
  for (let i = 0; i < N; i++) {
    const dl = i >= D ? arpR[i - D] * 0.38 : 0, dr = i >= D ? arpL[i - D] * 0.38 : 0;
    arpL[i] += dl; arpR[i] += dr;
    add(i, arpL[i] * 0.9 + arpR[i] * 0.1, arpR[i] * 0.9 + arpL[i] * 0.1);
  }

  // Master automation (the fade on the end card) and a soft-knee saturator that tames the beat peaks.
  const soft = (x) => Math.tanh(x * 2.3) / 2.3;
  for (let i = 0; i < N; i++) {
    const m = A.master(i / SR);
    L[i] = soft(L[i] * m); R[i] = soft(R[i] * m);
  }
  return { L, R };
}

// ---- Sound effects -------------------------------------------------------------------------------------
function render(len, fn) {
  const n = Math.round(len * SR), L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const [l, r] = fn(i / SR, i); L[i] = l; R[i] = r; }
  return { L, R };
}
/** Cursor click: a tiny noise transient with a short 1.8 kHz ring, then a softer release 55 ms later. */
function click() {
  const nz = rng(11), lp = new LP(5000);
  return render(0.16, (t) => {
    const hit = (t0, g) => { const d = t - t0; if (d < 0) return 0; const x = nz(); return ((x - lp.run(x)) * Math.exp(-d / 0.0012) * 0.6 + Math.sin(2 * Math.PI * 1800 * d) * Math.exp(-d / 0.006) * 0.5) * g; };
    const v = (hit(0, 1) + hit(0.055, 0.45)) * db(-14);
    return [v, v];
  });
}
/** Transition whoosh: filtered noise whose cutoff sweeps up and back, panned left to right. */
function whoosh() {
  const nz = rng(23), lp = new LP(300), hp = new LP(150);
  return render(0.7, (t) => {
    const u = t / 0.7;
    lp.set(250 + 3400 * Math.sin(Math.PI * u) ** 1.5);
    const x = nz(); const y = lp.run(x); const v = (y - hp.run(y)) * Math.sin(Math.PI * u) ** 2 * db(-16);
    const pan = -0.5 + u;
    return [v * (1 - pan) * 0.5 + v * 0.5, v * (1 + pan) * 0.5 + v * 0.5];
  });
}
/** Counter tick: a 2.2 kHz blip, 10 ms. */
function tick() {
  return render(0.05, (t) => { const v = tri(2200 * t) * Math.exp(-t / 0.008) * Math.min(1, t / 0.0008) * db(-22); return [v, v]; });
}
/** Logo hit: a sub drop, a short noise swell into the impact and an A minor stab that rings out. */
function hit() {
  const nz = rng(5), lp = new LP(1200), stab = [57, 60, 64, 69].map((n) => midi(n));
  const T = 0.12; // the swell leads the impact by 120 ms
  return render(1.9, (t) => {
    const d = t - T;
    const swell = (lp.run(nz()) * Math.min(1, t / T) ** 2) * (t < T ? 1 : Math.exp(-d / 0.05)) * 0.25;
    if (d < 0) return [swell, swell];
    const sub = Math.sin(2 * Math.PI * (38 * d + 32 * 0.09 * (1 - Math.exp(-d / 0.09)))) * Math.exp(-d / 0.45) * 0.7;
    let s = 0; for (const f of stab) s += saw(f * d) * 0.08 + saw(f * 1.004 * d) * 0.08;
    s *= Math.exp(-d / 0.6) * Math.min(1, d / 0.01);
    const v = (sub + s + swell) * db(-12);
    return [v, v];
  });
}

const b = bed(); writeWav(join(OUT, "bed.wav"), b.L, b.R);
for (const [name, fn] of [["click", click], ["whoosh", whoosh], ["tick", tick], ["hit", hit]]) { const s = fn(); writeWav(join(OUT, `sfx-${name}.wav`), s.L, s.R); }
console.log("wrote bed.wav and sfx-click/whoosh/tick/hit.wav to public/audio");
