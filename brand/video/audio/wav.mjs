// Minimal WAV I/O and DSP helpers shared by the synth and the loudness meter. No dependencies.
import { readFileSync, writeFileSync } from "node:fs";

export const SR = 48000;

/** Writes stereo float buffers as 24-bit PCM WAV. */
export function writeWav(path, L, R, sr = SR) {
  const n = L.length, bytes = 3, ch = 2;
  const data = Buffer.alloc(n * ch * bytes);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, c === 0 ? L[i] : R[i]));
      const s = Math.round(v * 8388607);
      const o = (i * ch + c) * bytes;
      data[o] = s & 255; data[o + 1] = (s >> 8) & 255; data[o + 2] = (s >> 16) & 255;
    }
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * ch * bytes, 28); h.writeUInt16LE(ch * bytes, 32); h.writeUInt16LE(bytes * 8, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

/** Reads a 16/24/32-bit PCM or 32-bit float WAV into float stereo (mono is duplicated). */
export function readWav(path) {
  const b = readFileSync(path);
  let p = 12, fmt = null, data = null;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4), len = b.readUInt32LE(p + 4);
    if (id === "fmt ") fmt = { tag: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === "data") { data = b.subarray(p + 8, p + 8 + len); break; }
    p += 8 + len + (len & 1);
  }
  if (!fmt || !data) throw new Error(`not a PCM wav: ${path}`);
  const bytes = fmt.bits / 8, n = Math.floor(data.length / (bytes * fmt.ch));
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < fmt.ch && c < 2; c++) {
      const o = (i * fmt.ch + c) * bytes;
      let v;
      if (fmt.tag === 3) v = data.readFloatLE(o);
      else if (bytes === 2) v = data.readInt16LE(o) / 32768;
      else if (bytes === 3) v = ((data[o] | (data[o + 1] << 8) | (data[o + 2] << 16)) << 8 >> 8) / 8388608;
      else v = data.readInt32LE(o) / 2147483648;
      if (c === 0) L[i] = v; else R[i] = v;
    }
    if (fmt.ch === 1) R[i] = L[i];
  }
  return { L, R, sr: fmt.sr };
}

export const midi = (n) => 440 * 2 ** ((n - 69) / 12);
export const db = (d) => 10 ** (d / 20);
export const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Attack / decay to sustain / release envelope value at time t (s) for a note of length `len`. */
export function adsr(t, len, a, d, s, r) {
  if (t < 0) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < len) return s;
  const rt = t - len;
  return rt < r ? s * (1 - rt / r) : 0;
}

/** One-pole low-pass, stateful. */
export class LP { constructor(hz) { this.set(hz); this.y = 0; } set(hz) { this.a = 1 - Math.exp(-2 * Math.PI * hz / SR); } run(x) { return (this.y += this.a * (x - this.y)); } }
/** Deterministic noise. */
export function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; }; }
