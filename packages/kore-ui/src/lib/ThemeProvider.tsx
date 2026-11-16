"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  THEME_IDS,
  THEME_STORAGE_KEY,
  koreThemeColor,
  type ThemeId,
  type ThemePreference,
} from "./theme";

export type ThemeProviderProps = {
  /** What to use when nothing is stored. Default "color", the original look, so adopting kore-ui changes nothing. */
  defaultTheme?: ThemePreference;
  /** Which theme "system" gives when the OS is dark. Default "color". A light OS always gets "light". */
  systemDarkTheme?: Exclude<ThemeId, "light">;
  /** localStorage key. Default "kore-theme". Pass `false` to not store the choice (the app keeps it). */
  storageKey?: string | false;
  /** Called after the user changes the theme: persist it to the user's settings here if you want it on every device. */
  onThemeChange?: (preference: ThemePreference) => void;
  children: ReactNode;
};

export type ThemeApi = {
  /** The theme in effect (never "system"). */
  theme: ThemeId;
  /** What the user chose, which may be "system". */
  preference: ThemePreference;
  setTheme: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeApi | null>(null);

/** The current theme and a setter. Outside a provider it reports "color" and does nothing. */
export function useTheme(): ThemeApi {
  return useContext(ThemeContext) ?? { theme: "color", preference: "color", setTheme: () => {} };
}

function isPreference(value: unknown): value is ThemePreference {
  return value === "system" || (THEME_IDS as readonly unknown[]).includes(value);
}

function systemPrefersLight(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches;
}

function readStored(key: string | false): ThemePreference | null {
  if (key === false || typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(key);
    return isPreference(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Applies the theme: sets `data-theme` on `<html>`, keeps `<meta name="theme-color">` in step, follows the OS
 * while the preference is "system", and syncs across tabs. Included in `KoreProvider`; use it directly only when you
 * don't use that. Pair it with `themeInitScript()` in `<head>` so a stored choice shows from the first paint.
 */
export function ThemeProvider({
  defaultTheme = "color",
  systemDarkTheme = "color",
  storageKey = THEME_STORAGE_KEY,
  onThemeChange,
  children,
}: ThemeProviderProps) {
  const [preference, setPreference] = useState<ThemePreference>(defaultTheme);
  const [light, setLight] = useState(false);

  // After hydration: the stored choice and the OS setting (reading them during render would mismatch the server).
  useEffect(() => {
    const stored = readStored(storageKey);
    if (stored) setPreference(stored);
    setLight(systemPrefersLight());
  }, [storageKey]);

  useEffect(() => {
    if (preference !== "system" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => setLight(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, [preference]);

  useEffect(() => {
    if (storageKey === false) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey && isPreference(event.newValue)) setPreference(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  const theme: ThemeId = preference === "system" ? (light ? "light" : systemDarkTheme) : preference;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", koreThemeColor(theme));
  }, [theme]);

  const setTheme = useCallback(
    (next: ThemePreference) => {
      setPreference(next);
      if (storageKey !== false) {
        try {
          window.localStorage.setItem(storageKey, next);
        } catch {
          // Private mode or blocked storage: the choice still applies for this visit.
        }
      }
      onThemeChange?.(next);
    },
    [storageKey, onThemeChange],
  );

  const value = useMemo(() => ({ theme, preference, setTheme }), [theme, preference, setTheme]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
}
