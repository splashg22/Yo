/**
 * Fetching something from an address a stranger chose: a coin's description and picture, which its creator points
 * to from the chain. Everything here assumes the address was picked to attack this server.
 *
 *   - https only, the usual port only, no name and password in the address;
 *   - never an address on this machine or a private network, by name or by number, and every redirect is checked again;
 *   - a size limit that is enforced while reading, and a time limit;
 *   - what comes back is never passed on as it arrived: a description is read as JSON for one field, and a picture is
 *     decoded and drawn again (lib/server/coin-image.ts).
 *
 * Where requests leave through an outbound proxy (HTTPS_PROXY with NODE_USE_ENV_PROXY=1), the proxy resolves the name;
 * the checks on the name still apply here. Without a proxy, the name is resolved here and every address it resolves to
 * must be a public one. A name that changes its answer between that check and the connection is not defended against
 * here: such a request could reach a private address, but nothing of the answer is passed on unless it decodes as an
 * image, so what it could do is make this server send one GET.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const IPFS_GATEWAY = "https://ipfs.io/ipfs/";
const ARWEAVE_GATEWAY = "https://arweave.net/";
const MAX_REDIRECTS = 3;

/** True for an address anyone on the internet could reach: not this machine, not a private or reserved range. */
export function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (kind === 6) {
    const text = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(text);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (text === "::" || text === "::1") return false;
    // Unique local (fc00::/7), link local (fe80::/10), multicast (ff00::/8), and anything written as mapped hex.
    if (/^f[cd]/.test(text) || /^fe[89ab]/.test(text) || text.startsWith("ff") || text.startsWith("::ffff:")) return false;
    return true;
  }
  return false;
}

/**
 * The https address to fetch for what a coin points to, or a refusal in one sentence.
 * ipfs:// and ar:// are read through a public gateway.
 */
export function outsideUrl(raw: string): URL {
  let text = raw.trim();
  if (text.length > 600) throw new Error("the address is too long");
  if (/^ipfs:\/\//i.test(text)) text = IPFS_GATEWAY + text.slice(7).replace(/^ipfs\//i, "");
  else if (/^ar:\/\//i.test(text)) text = ARWEAVE_GATEWAY + text.slice(5);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("not an address");
  }
  if (url.protocol !== "https:") throw new Error("only https addresses are fetched");
  if (url.username || url.password) throw new Error("an address with a name or password in it is not fetched");
  if (url.port !== "" && url.port !== "443") throw new Error("only the usual https port is fetched");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new Error("a private address is not fetched");
  } else if (!host.includes(".") || /(^|\.)(localhost|local|internal|lan|home|corp|intranet|test|invalid|example)$/.test(host)) {
    throw new Error("a private name is not fetched");
  }
  return url;
}

const proxied = (): boolean => process.env.NODE_USE_ENV_PROXY === "1" && Boolean(process.env.HTTPS_PROXY ?? process.env.https_proxy);

async function resolvesPublicly(host: string): Promise<void> {
  if (isIP(host) || proxied()) return;
  const found = await lookup(host, { all: true });
  if (found.length === 0 || !found.every((entry) => isPublicAddress(entry.address))) throw new Error("that name leads to a private address");
}

export interface Fetched {
  bytes: Buffer;
  type: string;
}
/** Fetches up to `maxBytes` from a stranger's address. Throws one plain sentence when it will not or cannot. */
export async function fetchOutside(raw: string, options: { maxBytes: number; timeoutMs?: number }): Promise<Fetched> {
  let url = outsideUrl(raw);
  const ended = AbortSignal.timeout(options.timeoutMs ?? 8_000);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await resolvesPublicly(url.hostname.replace(/^\[|\]$/g, ""));
    const response = await fetch(url, { redirect: "manual", signal: ended, headers: { accept: "application/json, image/*;q=0.9, */*;q=0.1" } });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      if (!next) throw new Error("a redirect that leads nowhere");
      url = outsideUrl(new URL(next, url).toString());
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`the address answered ${response.status}`);
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > options.maxBytes) {
      await response.body?.cancel();
      throw new Error("what is there is too large");
    }
    const parts: Uint8Array[] = [];
    let size = 0;
    if (response.body)
      for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) {
        size += part.length;
        if (size > options.maxBytes) throw new Error("what is there is too large");
        parts.push(part);
      }
    return { bytes: Buffer.concat(parts), type: response.headers.get("content-type") ?? "" };
  }
  throw new Error("too many redirects");
}
