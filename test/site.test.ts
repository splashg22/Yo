import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import media from "../lib/media.json";
import { FORBIDDEN_CLAIMS, VISIBILITY, visibilityOf } from "../lib/visibility";
import { nav, site } from "../site.config";

const root = join(__dirname, "..");
function sources(...dirs: string[]): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(tsx?|css)$/.test(entry.name)) out.push({ path, text: readFileSync(join(root, path), "utf8") });
    }
  };
  dirs.forEach(walk);
  return out;
}
const site_files = [...sources("app", "components", "lib"), { path: "site.config.ts", text: readFileSync(join(root, "site.config.ts"), "utf8") }];

describe("one place for the name and the colour", () => {
  it("spells the name only in site.config.ts", () => {
    const offenders = site_files.filter((f) => f.path !== "site.config.ts" && f.text.includes(site.name)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
  it("writes the accent colour only as the CSS variable", () => {
    const offenders = site_files.filter((f) => /#f5a524/i.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual(["app/globals.css"]);
    expect(readFileSync(join(root, "app/globals.css"), "utf8").match(/#f5a524/gi)).toHaveLength(1);
  });
});

describe("what the site may say", () => {
  it("makes no claim the Default Ring does not deliver", () => {
    for (const file of site_files.filter((f) => f.path !== "lib/visibility.ts")) {
      for (const claim of FORBIDDEN_CLAIMS) expect(file.text.toLowerCase(), `${file.path} says "${claim}"`).not.toContain(claim);
    }
  });
  it("matches the research: transfers hide the coin and the amount, never the wallets", () => {
    const transfer = visibilityOf("transfer");
    expect(transfer.encrypted).toEqual(expect.arrayContaining(["The coin", "The amount"]));
    expect(transfer.public).toEqual(expect.arrayContaining(["Your wallet", "The recipient's wallet"]));
    for (const id of ["deposit", "withdraw", "curve-trade", "creator-fees"]) {
      expect(visibilityOf(id).public.join(" "), id).toMatch(/amount/i);
      expect(visibilityOf(id).public, id).toContain("Your wallet");
    }
    expect(visibilityOf("launch").encrypted).toEqual([]);
    expect(visibilityOf("curve-trade").encrypted).toEqual([]);
    for (const row of VISIBILITY) expect(row.public.length, row.id).toBeGreaterThan(0); // nothing is ever fully hidden
  });
  it("only shows privacy panels for actions in the table", () => {
    for (const file of site_files) {
      for (const [, id] of file.text.matchAll(/<PrivacyPanel action="([^"]+)"/g)) expect(() => visibilityOf(id!), `${file.path}: ${id}`).not.toThrow();
    }
  });
  it("uses no em dashes and none of the ruled-out typefaces", () => {
    for (const file of site_files) {
      expect(file.text, file.path).not.toContain("—");
      expect(file.text, file.path).not.toMatch(/\b(Inter|Geist|Space Grotesk)\b/);
      expect(file.text, file.path).not.toMatch(/gradient\(/);
    }
  });
  it("never upper-cases an address", () => {
    expect(readFileSync(join(root, "app/globals.css"), "utf8")).toMatch(/\.address \{[^}]*text-transform: none/);
  });
  it("shows no number that was not read from the chain", () => {
    expect(readFileSync(join(root, "components/Stats.tsx"), "utf8")).toContain("stats?.available &&");
    expect(readFileSync(join(root, "lib/server/handlers.ts"), "utf8")).toMatch(/available: coins\.length > 0/);
  });
});

describe("brand media", () => {
  const size = (file: string) => sharp(join(root, "brand", file)).metadata();
  it("has every file brand/README.md asks for, at the stated shape", async () => {
    const hero = await size("hero.png"), layers = await size("layers.png"), banner = await size("banner.png"), logo = await size("logo.png");
    for (const still of [hero, layers]) {
      expect(still.width).toBeGreaterThanOrEqual(3840);
      expect(still.width! / still.height!).toBeCloseTo(16 / 9, 2);
    }
    expect(banner.width! / banner.height!).toBeCloseTo(3, 2);
    expect(logo.width).toBe(logo.height);
    expect(statSync(join(root, "brand/hero.mp4")).size).toBeGreaterThan(100_000);
  });
  it("is on true black", async () => {
    for (const file of ["hero.png", "layers.png", "banner.png"]) {
      const corner = await sharp(join(root, "brand", file)).extract({ left: 0, top: 0, width: 64, height: 64 }).removeAlpha().raw().toBuffer();
      expect(Math.max(...corner), file).toBe(0);
    }
  });
  it("has a full frame sequence at every size", () => {
    expect(media.frames).toBe(96);
    for (const width of media.sequenceWidths) {
      expect(readdirSync(join(root, "public/media/seq", String(width))).length, String(width)).toBe(media.frames);
    }
    for (const name of ["hero", "layers"]) for (const width of media.stillWidths) expect(existsSync(join(root, `public/media/${name}-${width}.webp`))).toBe(true);
    expect(existsSync(join(root, "public/media/og.png"))).toBe(true);
  });
  it("keeps the first sequence load small", () => {
    const first = statSync(join(root, "public/media/seq/640/000.webp")).size + statSync(join(root, "public/media/hero-960.webp")).size;
    expect(first).toBeLessThan(120_000);
  });
});

describe("page structure", () => {
  it("names five layers, top to bottom", () => {
    expect(site.layers.map((l) => l.n)).toEqual(["01", "02", "03", "04", "05"]);
    expect(site.layers.map((l) => l.label)).toEqual(["Your wallet", "The coin", "The amount", "The Ring", "The public chain"]);
    const heights = site.layers.map((l) => l.y);
    expect([...heights].sort((a, b) => a - b)).toEqual(heights);
  });
  it("has a page for every link", () => {
    for (const href of [...nav.map((n) => n.href), "/terms", "/privacy"]) expect(existsSync(join(root, "app", href, "page.tsx")), href).toBe(true);
  });
  it("says it is independent, on devnet and alpha", () => {
    const footer = readFileSync(join(root, "components/Chrome.tsx"), "utf8");
    expect(footer).toMatch(/independent project/);
    expect(footer).toMatch(/not affiliated with[\s\S]*Helius, pump\.fun/);
    expect(footer).toMatch(/alpha software/);
    expect(site.network).toBe("devnet");
  });
});
