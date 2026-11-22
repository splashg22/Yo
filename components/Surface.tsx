"use client";

/**
 * Keeps <html> saying what kind of page this is as the person moves between pages without a reload, and gives
 * the two display settings of the working screens: dark or light, compact or comfortable. Both are remembered.
 */
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { DENSITY_COOKIE, PREVIEW_COOKIE, THEME_COOKIE, densityOf, isWorkPath, themeOf, type Density, type Theme } from "@/lib/surface";
import { Segments } from "./ui/controls";

const YEAR = 31_536_000;
const cookie = (name: string): string | undefined =>
  typeof document === "undefined"
    ? undefined
    : document.cookie
        .split("; ")
        .find((entry) => entry.startsWith(`${name}=`))
        ?.slice(name.length + 1);
const listeners = new Set<() => void>();
const listen = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
function set(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/; max-age=${YEAR}; samesite=lax`;
  document.documentElement.dataset[name === THEME_COOKIE ? "theme" : "density"] = value;
  for (const listener of listeners) listener();
}
/** True where the working theme applies to this page. */
export function useWorkSurface(): boolean {
  return useSyncExternalStore(
    listen,
    () => document.documentElement.dataset.surface === "work",
    () => false,
  );
}
export function useDensity(): Density {
  return useSyncExternalStore(
    listen,
    () => densityOf(document.documentElement.dataset.density),
    () => "compact" as const,
  );
}
function useTheme(): Theme {
  return useSyncExternalStore(
    listen,
    () => themeOf(document.documentElement.dataset.theme),
    () => "dark" as const,
  );
}

export function SurfaceSync() {
  const pathname = usePathname();
  useEffect(() => {
    const root = document.documentElement;
    if (cookie(PREVIEW_COOKIE) === "preview" && isWorkPath(pathname)) root.dataset.surface = "work";
    else delete root.dataset.surface;
    for (const listener of listeners) listener();
  }, [pathname]);
  return null;
}

/** The two settings, where the working theme applies. Nothing where it does not. */
export function DisplaySettings() {
  const work = useWorkSurface();
  const theme = useTheme();
  const density = useDensity();
  if (!work) return null;
  return (
    <span className="display-settings">
      <Segments
        label="Theme"
        value={theme}
        onChange={(next) => set(THEME_COOKIE, next)}
        options={[
          { value: "dark", label: "Dark" },
          { value: "light", label: "Light" },
        ]}
      />
      <Segments
        label="Row size"
        value={density}
        onChange={(next) => set(DENSITY_COOKIE, next)}
        options={[
          { value: "compact", label: "Compact" },
          { value: "comfortable", label: "Comfortable" },
        ]}
      />
    </span>
  );
}
