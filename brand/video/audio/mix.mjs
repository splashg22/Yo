// Mixes the bed and the effects exactly as the composition places them (src/cues.json), measures the
// result with an ITU-R BS.1770-4 integrated-loudness meter written here, then scales every file so the
// sum lands at the target (default -14 LUFS) with the sample peak under -1 dBFS. Remotion sums the same
// files at the same frames, so the render carries the measured loudness.
//   node audio/mix.mjs [--target -14] [--measure-only path.wav]
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { readWav, writeWav } from "./wav.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PUB = join(here, "..", "public");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const target = Number(arg("target", "-14"));

/** BS.1770-4: K-weighting (two biquads, 48 kHz coefficients), 400 ms blocks at 75 % overlap, −70 LUFS absolute and −10 LU relative gates. */
export function loudness(L, R, sr = 48000) {
  if (sr !== 48000) throw new Error("meter coefficients are for 48 kHz");
  const stages = [
    { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [1, -1.69065929318241, 0.73248077421585] },
    { b: [1.0, -2.0, 1.0], a: [1, -1.99004745483398, 0.99007225036621] },
  ];
  const kw = (x) => {
    let y = Float64Array.from(x);
    for (const { b, a } of stages) {
      const out = new Float64Array(y.length);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < y.length; i++) { const v = b[0] * y[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2; x2 = x1; x1 = y[i]; y2 = y1; y1 = v; out[i] = v; }
      y = out;
    }
    return y;
  };
  const kl = kw(L), kr = kw(R);
  const block = Math.round(0.4 * sr), hop = Math.round(0.1 * sr);
  const blocks = [];
  for (let s = 0; s + block <= kl.length; s += hop) {
    let p = 0;
    for (let i = s; i < s + block; i++) p += kl[i] * kl[i] + kr[i] * kr[i];
    p /= block;
    blocks.push({ p, l: -0.691 + 10 * Math.log10(p || 1e-20) });
  }
  const abs = blocks.filter((b) => b.l > -70);
  if (!abs.length) return { integrated: -Infinity, shortTermMax: -Infinity };
  const meanAbs = abs.reduce((a, b) => a + b.p, 0) / abs.length;
  const rel = -0.691 + 10 * Math.log10(meanAbs) - 10;
  const gated = abs.filter((b) => b.l > rel);
  const mean = gated.reduce((a, b) => a + b.p, 0) / gated.length;
  // Short-term (3 s) maximum, for the report.
  const st = Math.round(3 * sr);
  let stMax = -Infinity;
  for (let s = 0; s + st <= kl.length; s += hop) { let p = 0; for (let i = s; i < s + st; i++) p += kl[i] * kl[i] + kr[i] * kr[i]; stMax = Math.max(stMax, -0.691 + 10 * Math.log10(p / st || 1e-20)); }
  return { integrated: -0.691 + 10 * Math.log10(mean), shortTermMax: stMax };
}
const stats = (L, R) => {
  let peak = 0, sq = 0;
  for (let i = 0; i < L.length; i++) { peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); sq += L[i] * L[i] + R[i] * R[i]; }
  // Sample peak only: true (inter-sample) peak is not measured here.
  return { peakDb: 20 * Math.log10(peak), rmsDb: 10 * Math.log10(sq / (2 * L.length)) };
};

const only = arg("measure-only", null);
if (only) {
  const w = readWav(only); const m = loudness(w.L, w.R, w.sr), s = stats(w.L, w.R);
  console.log(JSON.stringify({ file: only, ...m, ...s }, null, 1));
  process.exit(0);
}

const cfg = JSON.parse(readFileSync(join(here, "..", "src", "cues.json"), "utf8"));
const bed = readWav(join(PUB, cfg.bed));
const sfx = {};
for (const name of new Set(cfg.cues.map((c) => c.sfx))) sfx[name] = readWav(join(PUB, `audio/sfx-${name}.wav`));
const n = bed.L.length;
const L = Float32Array.from(bed.L, (v) => v * cfg.bedGain), R = Float32Array.from(bed.R, (v) => v * cfg.bedGain);
for (const c of cfg.cues) {
  const s = sfx[c.sfx], at = Math.round((c.frame / cfg.fps) * 48000);
  for (let i = 0; i < s.L.length && at + i < n; i++) { L[at + i] += s.L[i] * c.gain; R[at + i] += s.R[i] * c.gain; }
}
const before = { ...loudness(L, R), ...stats(L, R) };
let gainDb = target - before.integrated;
const headroom = -1 - before.peakDb; // keep the sample peak under −1 dBFS
if (gainDb > headroom) { console.log(`loudness target needs +${gainDb.toFixed(2)} dB but the peak allows only +${headroom.toFixed(2)} dB; using the peak limit`); gainDb = headroom; }
const g = 10 ** (gainDb / 20);
for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
const after = { ...loudness(L, R), ...stats(L, R) };
// Bake the same gain into every file the composition plays, so Remotion's sum equals this mix.
writeWav(join(PUB, cfg.bed), Float32Array.from(bed.L, (v) => v * cfg.bedGain * g), Float32Array.from(bed.R, (v) => v * cfg.bedGain * g));
for (const [name, s] of Object.entries(sfx)) writeWav(join(PUB, `audio/sfx-${name}.wav`), Float32Array.from(s.L, (v) => v * g), Float32Array.from(s.R, (v) => v * g));
writeWav(join(PUB, "audio", "mix-preview.wav"), L, R);
const report = { target, appliedGainDb: gainDb, before, after, measuredAt: new Date().toISOString(), note: "BS.1770-4 integrated loudness (K-weighted, gated), sample peak (true peak not measured) and RMS, measured on the offline sum of bed + cues; bedGain in cues.json is 1 after baking." };
writeFileSync(join(PUB, "audio", "loudness.json"), JSON.stringify(report, null, 1));
cfg.bedGain = 1; writeFileSync(join(here, "..", "src", "cues.json"), JSON.stringify(cfg, null, 1));
console.log(JSON.stringify(report, null, 1));
