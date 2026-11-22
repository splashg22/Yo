"use strict";
// The four functions of bigint-buffer, in plain JavaScript.
//
// The published package ships a native addon whose toBigIntLE reads past the end of its buffer
// (GHSA-3gc7-fjrx-p6mg) and has no fixed release. This is its own pure-JavaScript fallback, which the
// package uses in browsers and whenever the addon fails to load, made the only path. No native code.
Object.defineProperty(exports, "__esModule", { value: true });

function toBigIntLE(buf) {
  const reversed = Buffer.from(buf);
  reversed.reverse();
  const hex = reversed.toString("hex");
  return hex.length === 0 ? BigInt(0) : BigInt(`0x${hex}`);
}
function toBigIntBE(buf) {
  const hex = Buffer.from(buf).toString("hex");
  return hex.length === 0 ? BigInt(0) : BigInt(`0x${hex}`);
}
function toBufferLE(num, width) {
  const hex = num.toString(16);
  const buffer = Buffer.from(hex.padStart(width * 2, "0").slice(0, width * 2), "hex");
  buffer.reverse();
  return buffer;
}
function toBufferBE(num, width) {
  const hex = num.toString(16);
  return Buffer.from(hex.padStart(width * 2, "0").slice(0, width * 2), "hex");
}
exports.toBigIntLE = toBigIntLE;
exports.toBigIntBE = toBigIntBE;
exports.toBufferLE = toBufferLE;
exports.toBufferBE = toBufferBE;
