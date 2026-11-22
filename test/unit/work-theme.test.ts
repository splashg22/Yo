/**
 * The working screens' theme, held to numbers: every colour of text against every surface it can sit on, in dark
 * and in light, by the WCAG contrast formula. And the rule that the theme is variables: no colour is written
 * anywhere in its file but in the two blocks that define them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isWorkPath } from "../../lib/surface";

const root = join(__dirname, "..", "..");
const css = readFileSync(join(root, "app", "work-theme.css"), "utf8");
const accent = /--accent:\s*(#[0-9a-f]{6})/i.exec(readFileSync(join(root, "app", "globals.css"), "utf8"))![1]!;

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  const body = css.slice(start, css.indexOf("}", start));
  const found: Record<string, string> = {};
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) found[match[1]!] = match[2]!.trim();
  return found;
}
const dark = block('html[data-surface="work"]');
const light = { ...dark, ...block('html[data-surface="work"][data-theme="light"]') };
// The two friendlier styles share one palette, laid over the plain theme's.
const styledDark = { ...dark, ...block('html[data-surface="work"][data-style]') };
const styledLight = { ...light, ...block('html[data-surface="work"][data-style]'), ...block('html[data-surface="work"][data-style][data-theme="light"]') };
/** A variable's colour, following var(--x) to its value. */
function colour(theme: Record<string, string>, name: string): string {
  let value = name === "accent" ? accent : theme[name];
  for (let hop = 0; hop < 5 && value?.startsWith("var("); hop++) {
    const next = /var\(--([a-z0-9-]+)\)/.exec(value)![1]!;
    value = next === "accent" ? accent : theme[next];
  }
  expect(value, name).toMatch(/^#[0-9a-f]{6}$/i);
  return value!;
}
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string): number => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
};
const SURFACES = ["page", "panel", "row", "hover"];
const TEXT = ["ink", "mute", "quiet", "buy", "sell", "accent-text"];

const warmDark = { ...styledDark, ...block('html[data-surface="work"][data-style="warm"]') };
const warmLight = {
  ...styledLight,
  ...block('html[data-surface="work"][data-style="warm"]'),
  ...block('html[data-surface="work"][data-style="warm"][data-theme="light"]'),
};
describe.each([
  ["friendlier styles: warm, dark", warmDark],
  ["friendlier styles: warm, light", warmLight],
  ["dark", dark],
  ["light", light],
  ["friendlier styles, dark", styledDark],
  ["friendlier styles, light", styledLight],
])("the working theme, %s", (name, theme) => {
  it("has four steps of surface, each distinct, and none of them pure black or pure white as the page", () => {
    const steps = SURFACES.map((name) => colour(theme, name));
    // The warm version outlines its panels on the page's own tone: three steps and a hairline.
    expect(new Set(steps).size).toBe(name.includes("warm") ? 3 : 4);
    expect(["#000000", "#ffffff"]).not.toContain(steps[0]!.toLowerCase());
  });

  it("keeps every colour of text readable on every surface: at least 4.5 to 1", () => {
    for (const text of TEXT)
      for (const surface of SURFACES) {
        const ratio = contrast(colour(theme, text), colour(theme, surface));
        expect(ratio, `${text} on ${surface}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
  });

  it("has three levels of text that can be told apart", () => {
    const [ink, mute, quiet] = ["ink", "mute", "quiet"].map((name) => contrast(colour(theme, name), colour(theme, "panel")));
    expect(ink! / mute!).toBeGreaterThan(1.3);
    expect(mute! / quiet!).toBeGreaterThan(1.3);
  });

  it("keeps the words on a filled control readable: on the accent, and on a pressed choice", () => {
    expect(contrast(colour(theme, "on-accent"), colour(theme, "accent-fill"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour(theme, "on-ink"), colour(theme, "ink"))).toBeGreaterThanOrEqual(4.5);
  });

  it("draws the edge of a control so it can be seen: at least 3 to 1 against what it sits on", () => {
    for (const surface of ["page", "panel", "row"]) {
      const ratio = contrast(colour(theme, "rule"), colour(theme, surface));
      expect(ratio, `rule on ${surface}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps coloured words readable on their own tint, and dark words readable on a filled pill", () => {
    if (!name.startsWith("friendlier")) return;
    expect(contrast(colour(theme, "buy"), colour(theme, "buy-wash"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour(theme, "sell"), colour(theme, "sell-wash"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour(theme, "on-fill"), colour(theme, "buy-fill"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour(theme, "on-fill"), colour(theme, "sell-fill"))).toBeGreaterThanOrEqual(4.5);
    // The two ends of the buys-to-sells bar can be told apart without their hue.
    expect(Math.abs(luminance(colour(theme, "buy-fill")) - luminance(colour(theme, "sell-fill")))).toBeGreaterThan(0.2);
  });

  it("keeps accent-coloured words readable on the accent's own tint", () => {
    if (!name.includes("warm")) return;
    expect(contrast(colour(theme, "accent-text"), colour(theme, "accent-wash"))).toBeGreaterThanOrEqual(4.5);
  });

  it("tells green from red by more than hue, for eyes that cannot: they differ in lightness too", () => {
    expect(Math.abs(luminance(colour(theme, "buy")) - luminance(colour(theme, "sell")))).toBeGreaterThan(0.03);
  });
});

describe("the working theme's file", () => {
  it("writes a colour only where it defines a variable", () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const line of rules.split("\n")) {
      if (/^\s*--[a-z0-9-]+:/.test(line)) continue;
      expect(line, line).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    }
  });
  it("applies to nothing unless the page is marked as a working screen", () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const selector of rules.matchAll(/(^|\})\s*([^{}@]+)\{/g)) {
      // Split on the commas between selectors, not the ones inside :is( ... ).
      let depth = 0;
      let part = "";
      const parts: string[] = [];
      for (const character of selector[2]!) {
        if (character === "(") depth += 1;
        if (character === ")") depth -= 1;
        if (character === "," && depth === 0) {
          parts.push(part);
          part = "";
        } else part += character;
      }
      parts.push(part);
      for (const each of parts) expect(each.trim(), each).toMatch(/^html\[data-surface="work"\]/);
    }
  });
  it("leaves the brand's pages alone, and takes the screens people work in", () => {
    for (const path of ["/", "/docs", "/technical", "/changelog", "/terms", "/privacy"]) expect(isWorkPath(path), path).toBe(false);
    for (const path of ["/terminal", "/coin/abc", "/portfolio", "/wallet", "/explore", "/launch", "/otc", "/pay", "/tx/abc", "/status"])
      expect(isWorkPath(path), path).toBe(true);
    // A page whose name only starts like a working screen's is not one.
    expect(isWorkPath("/terminally")).toBe(false);
  });
});
