/** The security headers sent with every answer. */
import { randomBytes } from "node:crypto";

export const newNonce = (): string => randomBytes(16).toString("base64");

/**
 * The content security policy. Scripts run only if they carry this request's nonce (or were loaded by one that
 * does); nothing is ever evaluated from text; the page talks only to this site; it cannot be framed.
 * Styles allow inline attributes, which the interface uses for sizes worked out at run time; no script can come in that way.
 */
export function contentSecurityPolicy(nonce: string, options: { dev: boolean; imageHosts: string[]; host?: string; connectHosts?: string[] }): string {
  // The live connection is a websocket to this same host. It is named outright: not every browser reads 'self' as covering it.
  const live = options.host && /^[\w.-]+(:\d+)?$/.test(options.host) ? ` ws://${options.host} wss://${options.host}` : "";
  return [
    "default-src 'self'",
    // In development the framework's hot reload evaluates code; a production build never does.
    // 'wasm-unsafe-eval' lets the sealing library's WebAssembly be compiled, and nothing else: no text is ever run as script.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${options.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${options.imageHosts.map((host) => ` ${host}`).join("")}`,
    "font-src 'self'",
    "media-src 'self'",
    `connect-src 'self'${live}${(options.connectHosts ?? []).map((extra) => ` ${extra}`).join("")}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Headers that do not depend on the request. HSTS is added only when the site is served over HTTPS: it is meaningless, and ignored, otherwise. */
export function fixedHeaders(https: boolean): Record<string, string> {
  return {
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    // No address of this site is passed on when a link leaves it: a coin page or a receipt says what someone was looking at.
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    // Nothing on this site uses any of these, so no script on it can ask for them either.
    "permissions-policy":
      "accelerometer=(), ambient-light-sensor=(), autoplay=(self), bluetooth=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), serial=(), usb=(), xr-spatial-tracking=()",
    ...(https ? { "strict-transport-security": "max-age=63072000; includeSubDomains" } : {}),
  };
}
