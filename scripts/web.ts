/**
 * Prepares the public proof pages in web/ for hosting.
 *
 *   npm run web [coin]    the coin's page goes live: writes config.json (public
 *                         addresses and settings only, never a secret) and copies
 *                         the public ledger next to the page
 *   npm run web:sites     rebuilds the page of every brand that has its own
 *                         folder (web/<slug>/index.html) from web/index.html
 *
 * web/index.html is the one page: it is the default brand's site as it stands,
 * and the template every other brand's page is made from. The page itself
 * reads the blockchain directly in the visitor's browser.
 */
import fs from "node:fs";
import path from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";
import { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import { listBrands, loadBrand, type Brand } from "../src/brand.js";
import { loadKeypair } from "../src/chain.js";
import { parseConfig, type Config } from "../src/config.js";
import { loadEnv } from "../src/env.js";

export const DEFAULT_PUBLIC_RPC = "https://solana-rpc.publicnode.com";

export interface WebConfig {
  title: string;
  theme: string;
  treasury: string;
  strategyMint: string;
  burnMint: string;
  holderMint: string;
  quoteMint: string | null;
  minHold: string;
  holderSymbol: string;
  /** Tickers and names the page shows for the pair token and the burn coin. */
  quoteSymbol: string;
  quoteName: string;
  burnSymbol: string;
  burnName: string;
  notAffiliatedWith: string;
  rpcUrl: string;
  repoUrl: string | null;
}

/** Only public facts go in here: the page is served to everyone. */
export function webConfig(
  config: Pick<Config, "brand" | "quoteSymbol" | "burnSymbol" | "holderSymbol" | "strategyMint" | "burnMint" | "holderMint" | "minHold" | "expectedQuoteMint" | "reportTitle">,
  treasury: string,
  extra: { quoteMint?: string | null; publicRpcUrl?: string; repoUrl?: string | null } = {},
): WebConfig {
  const publicRpcUrl = extra.publicRpcUrl?.trim() || DEFAULT_PUBLIC_RPC;
  if (!/^https:\/\//.test(publicRpcUrl)) throw new Error("PUBLIC_RPC_URL must start with https://");
  return {
    title: config.reportTitle,
    theme: config.brand.theme,
    treasury,
    strategyMint: config.strategyMint,
    burnMint: config.burnMint,
    holderMint: config.holderMint,
    quoteMint: extra.quoteMint ?? config.expectedQuoteMint ?? null,
    minHold: config.minHold,
    holderSymbol: config.holderSymbol || (config.holderMint === config.strategyMint ? "strategy coin" : "coins"),
    quoteSymbol: config.quoteSymbol,
    quoteName: config.brand.quoteName,
    burnSymbol: config.burnSymbol,
    // A coin that burns itself is named by its ticker; another burn coin by its name.
    burnName: config.burnSymbol === config.brand.burnSymbol ? config.brand.burnName : config.burnSymbol,
    notAffiliatedWith: config.brand.notAffiliatedWith,
    rpcUrl: publicRpcUrl,
    repoUrl: extra.repoUrl?.trim() || null,
  };
}

/** Where a brand's page lives: web/ itself, or web/<slug>/. */
export function siteDir(brand: Pick<Brand, "slug">, webDir: string): string {
  return brand.slug ? path.join(webDir, brand.slug) : webDir;
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Makes a brand's own page from web/index.html: theme, title, link-preview
 * text, logo and every branded word are written into the HTML itself, so the
 * page is right before any script runs and in link previews. Throws when the
 * template no longer has a part it expects, rather than publish a half-branded page.
 */
export function renderSite(template: string, brand: Brand): string {
  let html = template;
  const swap = (pattern: RegExp, replacement: string, what: string) => {
    if (!pattern.test(html)) throw new Error(`web/index.html no longer has ${what}; update renderSite in scripts/web.ts`);
    html = html.replace(pattern, (_all, before = "", after = "") => `${before}${replacement}${after}`);
  };
  const title = escapeHtml(brand.title);
  const burn = escapeHtml(brand.burnSymbol);
  const quote = escapeHtml(brand.quoteSymbol);
  // data-brand recolours the kit for this brand; data-theme is left for light and dark.
  swap(/(<html lang="en")(>)/, ` data-brand="${escapeHtml(brand.theme)}"`, "its <html> tag");
  swap(/(<title>)[^<]*(<\/title>)/, title, "a <title>");
  swap(/(<meta name="description" content=")[^"]*(">)/, `${title}: a pump.fun coin whose creator fees buy and burn ${burn} and pay holders in ${quote}, ${escapeHtml(brand.quoteName)}. Every transaction, verified live on Solana.`, "a description");
  swap(/(<meta property="og:title" content=")[^"]*(">)/, title, "an og:title");
  swap(/(<meta property="og:description" content=")[^"]*(">)/, `Half of every fee buys and burns ${burn}. Half pays holders in ${quote}. Proven live on-chain.`, "an og:description");
  swap(/(from ")\.\/proof\.js(")/, "../proof.js", "the proof.js import");
  // A brand's page lives one folder down, so the kit it shares with the default page is one folder up.
  if (!/"\.\/kit\//.test(html)) throw new Error("web/index.html no longer has the kit; update renderSite in scripts/web.ts");
  html = html.replace(/"\.\/kit\//g, '"../kit/');
  // The tickers the page's script starts with, before config.json is read.
  for (const ticker of [brand.quoteSymbol, brand.burnSymbol]) {
    if (!/^[A-Za-z0-9$._ -]{1,20}$/.test(ticker)) throw new Error(`brands/${brand.name}.json: "${ticker}" is not a ticker`);
  }
  swap(/(let Q = ")[^"]*(")/, brand.quoteSymbol, "the default pair ticker");
  swap(/(, B = ")[^"]*(";)/, brand.burnSymbol, "the default burn ticker");
  if (brand.logoPath) {
    if (!/^[\dA-Za-z .,-]+$/.test(brand.logoPath)) throw new Error(`brands/${brand.name}.json: "logoPath" is not an SVG path`);
    swap(/(<path data-logo d=")[^"]*(")/, brand.logoPath, "the logo path");
    const icon = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='${brand.faviconBg ?? "#000"}'/><path d='${brand.logoPath}' fill='none' stroke='${brand.accent ?? "#fff"}' stroke-width='5' stroke-linecap='square'/></svg>`;
    swap(/(<link rel="icon" href=")[^"]*(">)/, `data:image/svg+xml,${icon.replace(/[<>#"]/g, (c) => encodeURIComponent(c))}`, "a favicon");
  }
  const words: Record<string, string> = {
    title: brand.title, quote: brand.quoteSymbol, quoteName: brand.quoteName,
    burn: brand.burnSymbol, burnName: brand.burnName, notAffiliatedWith: brand.notAffiliatedWith,
  };
  const used = new Set<string>();
  html = html.replace(/(<[a-z0-9]+\b[^>]*\bdata-b="([A-Za-z]+)"[^>]*>)([^<]*)/g, (_all, open: string, key: string, old: string) => {
    used.add(key);
    return open + (key in words ? escapeHtml(words[key]!) : old);
  });
  for (const key of Object.keys(words)) {
    if (!used.has(key)) throw new Error(`web/index.html no longer has a data-b="${key}" element; update renderSite in scripts/web.ts`);
  }
  return html;
}

/** Writes web/<slug>/index.html for a brand that has its own folder. Returns the file, or null for the default site. */
export function writeSite(brand: Brand, webDir: string): string | null {
  if (!brand.slug) return null;
  const dir = siteDir(brand, webDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, renderSite(fs.readFileSync(path.join(webDir, "index.html"), "utf8"), brand));
  return file;
}

/** The token the coin is paired with: from the books if the bot has run, else read from the chain. */
async function findQuoteMint(config: Config, treasury: string): Promise<string | null> {
  const statePath = path.join(path.resolve(config.dataDir), "state.json");
  if (fs.existsSync(statePath)) {
    const quote = (JSON.parse(fs.readFileSync(statePath, "utf8")) as { quoteMint?: string }).quoteMint;
    if (quote) return quote;
  }
  try {
    const connection = new Connection(config.rpcUrl, "confirmed");
    const mint = new PublicKey(config.strategyMint);
    const info = await connection.getAccountInfo(mint);
    if (!info) throw new Error("STRATEGY_MINT does not exist on this network");
    const sell = await new OnlinePumpSdk(connection).fetchSellState(mint, new PublicKey(treasury), info.owner);
    return sell.quoteMint.toBase58();
  } catch (error) {
    console.warn(`Could not read the pair token from the chain (${(error as Error).message}); the page will work it out from payouts.`);
    return config.expectedQuoteMint;
  }
}

async function main() {
  const repo = process.cwd();
  const root = path.join(repo, "web");
  if (process.argv.includes("--sites")) {
    const built = listBrands(repo).map((name) => writeSite(loadBrand(name, repo), root)).filter(Boolean);
    console.log(built.length ? `Rebuilt ${built.map((f) => path.relative(repo, f!)).join(", ")} from web/index.html.` : "No brand has its own folder; nothing to build.");
    return;
  }
  loadEnv();
  const config = parseConfig(process.env);
  writeSite(config.brand, root);
  const webDir = siteDir(config.brand, root);
  const shown = path.relative(repo, webDir);
  const treasury = loadKeypair(path.resolve(config.treasuryKeypairPath)).publicKey.toBase58();
  const quoteMint = await findQuoteMint(config, treasury);
  const out = webConfig(config, treasury, {
    quoteMint,
    publicRpcUrl: process.env.PUBLIC_RPC_URL,
    repoUrl: process.env.REPO_URL,
  });
  if (out.rpcUrl === process.env.RPC_URL?.trim() && /api-key|apikey|key=|\/[A-Za-z0-9_-]{20,}$/.test(out.rpcUrl)) {
    throw new Error("PUBLIC_RPC_URL looks like it carries an API key. Use a key-free public endpoint for the page.");
  }
  fs.mkdirSync(webDir, { recursive: true });
  fs.writeFileSync(path.join(webDir, "config.json"), `${JSON.stringify(out, null, 2)}\n`);
  const ledger = path.join(path.resolve(config.dataDir), "ledger.jsonl");
  const published = path.join(webDir, "ledger.jsonl");
  if (fs.existsSync(ledger)) fs.copyFileSync(ledger, published);
  else fs.rmSync(published, { force: true });
  console.log(`${shown}/config.json written for ${config.brand.title}, treasury ${treasury}${out.quoteMint ? "" : ` (${config.quoteSymbol} mint not known yet: the page will read it from the chain)`}.`);
  console.log(fs.existsSync(ledger) ? `${shown}/ledger.jsonl refreshed from ${config.dataDir}/ledger.jsonl.` : "No ledger yet; the page will show chain data only.");
  console.log("Publish with `npm run web:publish` (see README: Public proof pages).");
}

if (process.argv[1] && /web\.(ts|js)$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
