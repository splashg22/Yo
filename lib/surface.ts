/**
 * Which pages are working screens (they take the working theme, app/work-theme.css) and which are the brand's
 * (the homepage and the pages that explain the product, which keep the brand's own look). And the two things a
 * person may set about the working screens, each remembered in a cookie so the first paint is already right.
 */
const WORK = ["/terminal", "/coin", "/portfolio", "/explore", "/wallet", "/launch", "/otc", "/pay", "/tx", "/status"];
export const isWorkPath = (path: string): boolean => WORK.some((start) => path === start || path.startsWith(`${start}/`));

export type Theme = "dark" | "light";
export type Density = "compact" | "comfortable";
export const THEME_COOKIE = "ring-theme";
export const DENSITY_COOKIE = "ring-density";
/** The working screens' look. The other two were drawn for comparison and can still be seen by setting the style cookie. */
export const DEFAULT_STYLE = "warm" as const;
/** Two friendlier versions of the working theme, being looked at side by side. Neither is the default. */
export type Style = "soft" | "playful" | "warm";
export const STYLE_COOKIE = "ring-style";
export const styleOf = (value: string | undefined): Style | undefined => (value === "soft" || value === "playful" || value === "warm" ? value : undefined);
export const themeOf = (value: string | undefined): Theme => (value === "light" ? "light" : "dark");
export const densityOf = (value: string | undefined): Density => (value === "comfortable" ? "comfortable" : "compact");
/** The header the server hands the page's path in (server/app.ts sets it; whatever a caller sent is replaced). */
export const PATH_HEADER = "x-ring-path";
