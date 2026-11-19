/**
 * A brand is the public face of one strategy coin: its name, the tickers
 * shown in the terminal, alerts and proof page, and which coin is burned by
 * default. Brands are plain JSON files in brands/ and hold nothing secret.
 * `.env` picks one with BRAND=<file name without .json>.
 */
import fs from "node:fs";
import path from "node:path";

export interface Brand {
  /** File name without .json, as written in BRAND=. */
  name: string;
  /** Folder of the proof page under web/. Empty = web/ itself (the site root). */
  slug: string;
  title: string;
  /** The brand's colours on its pages: a `:root[data-brand="..."]` block that recolours the kit. */
  theme: string;
  /** Ticker of the strategy coin; empty when it has none yet. */
  coinSymbol: string;
  /** The token the coin is paired with, which fees and rewards are paid in. */
  quoteSymbol: string;
  quoteName: string;
  /** The coin that is bought and burned. */
  burnSymbol: string;
  burnName: string;
  /** Default BURN_MINT. null = the strategy coin buys back and burns itself. */
  burnMint: string | null;
  /** Ends the sentence "Not affiliated with …" in the page footer. */
  notAffiliatedWith: string;
  /** Proof-page logo (an SVG path in a 64x64 box) and favicon colours; themed pages only. */
  logoPath?: string;
  faviconBg?: string;
  accent?: string;
}

export const DEFAULT_BRAND = "dacity";

export function brandsDir(root = process.cwd()): string {
  return path.join(root, "brands");
}

export function listBrands(root = process.cwd()): string[] {
  return fs.readdirSync(brandsDir(root)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
}

export function parseBrand(name: string, raw: unknown): Brand {
  if (typeof raw !== "object" || raw === null) throw new Error(`brands/${name}.json is not a JSON object`);
  const data = raw as Record<string, unknown>;
  const text = (key: string, optional = false): string => {
    const value = data[key];
    if (typeof value === "string" && (value.trim() || optional)) return value.trim();
    if (optional && value === undefined) return "";
    throw new Error(`brands/${name}.json: "${key}" must be ${optional ? "text" : "non-empty text"}`);
  };
  const slug = text("slug", true);
  if (slug && !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`brands/${name}.json: "slug" may only use a-z, 0-9 and -`);
  const burnMint = data.burnMint === null || data.burnMint === undefined ? null : text("burnMint");
  return {
    name,
    slug,
    title: text("title"),
    theme: text("theme"),
    coinSymbol: text("coinSymbol", true),
    quoteSymbol: text("quoteSymbol"),
    quoteName: text("quoteName"),
    burnSymbol: text("burnSymbol"),
    burnName: text("burnName"),
    burnMint,
    notAffiliatedWith: text("notAffiliatedWith"),
    logoPath: text("logoPath", true) || undefined,
    faviconBg: text("faviconBg", true) || undefined,
    accent: text("accent", true) || undefined,
  };
}

export function loadBrand(name: string | undefined, root = process.cwd()): Brand {
  const wanted = name?.trim() || DEFAULT_BRAND;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(wanted)) throw new Error(`BRAND must be a brand file name such as ${DEFAULT_BRAND}, got "${wanted}"`);
  const file = path.join(brandsDir(root), `${wanted}.json`);
  if (!fs.existsSync(file)) throw new Error(`BRAND=${wanted}: there is no brands/${wanted}.json (available: ${listBrands(root).join(", ")})`);
  return parseBrand(wanted, JSON.parse(fs.readFileSync(file, "utf8")));
}
