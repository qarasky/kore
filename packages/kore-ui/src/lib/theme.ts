/**
 * The themes' colours as hex strings, for the few places CSS variables cannot reach: `<meta name="theme-color">`,
 * web app manifests, SVG icons, canvas and QR codes, and the previews in `ThemeSwitcher`. Everything that
 * renders in the DOM uses the tokens (`bg-surface`, `var(--color-accent)`) instead, and follows the theme by
 * itself. A test keeps these equal to theme.css. Server-safe: plain data.
 */

/** `color` is the original blue-grey dark theme, `light` white with the same accent, `dark` pure black for OLED. */
export type ThemeId = "color" | "light" | "dark";

/** A user's choice: a theme, or follow the operating system. */
export type ThemePreference = ThemeId | "system";

export const THEME_IDS = ["color", "light", "dark"] as const satisfies readonly ThemeId[];

/** The default key under which the choice is stored (localStorage). */
export const THEME_STORAGE_KEY = "kore-theme";

export type ThemePalette = {
  bg: string;
  surface: string;
  raised: string;
  border: string;
  borderStrong: string;
  text: string;
  muted: string;
  accent: string;
  /** The accent where it is used as text or a thin line. */
  accentFg: string;
  danger: string;
  warning: string;
  statusUp: string;
  statusWarn: string;
  statusDown: string;
  statusMaint: string;
  statusOff: string;
};

const COLOR: ThemePalette = {
  bg: "#16181d",
  surface: "#1d2026",
  raised: "#23262d",
  border: "#2c3038",
  borderStrong: "#3a3f49",
  text: "#e6e8ee",
  muted: "#8a8f9a",
  accent: "#5b8def",
  accentFg: "#5b8def",
  danger: "#f2777a",
  warning: "#e5a54b",
  statusUp: "#3fb950",
  statusWarn: "#f0c54b",
  statusDown: "#e5484d",
  statusMaint: "#a371f7",
  statusOff: "#5b616d",
};

export const KORE_THEMES: Record<ThemeId, ThemePalette> = {
  color: COLOR,
  light: {
    bg: "#f7f8fa",
    surface: "#ffffff",
    raised: "#ffffff",
    border: "#e2e4ea",
    borderStrong: "#c9ccd5",
    text: "#16181d",
    muted: "#5a606c",
    accent: "#5b8def",
    accentFg: "#2c5fc9",
    danger: "#c0262c",
    warning: "#8f5200",
    statusUp: "#176f31",
    statusWarn: "#8a6100",
    statusDown: "#cf222e",
    statusMaint: "#7c4bd6",
    statusOff: "#8b919c",
  },
  dark: {
    ...COLOR,
    bg: "#000000",
    surface: "#0b0b0d",
    raised: "#161619",
    border: "#232327",
    borderStrong: "#36363c",
    text: "#ececf0",
    muted: "#8d929d",
  },
};

/** The Color theme's palette (what `KORE_THEME` always was). Prefer `KORE_THEMES[theme]` when the theme can change. */
export const KORE_THEME: ThemePalette = KORE_THEMES.color;

/** The value for `<meta name="theme-color">` and a manifest's `theme_color` / `background_color` in the Color theme. */
export const KORE_THEME_COLOR = KORE_THEME.bg;

/** `<meta name="theme-color">` for a theme: the page background, so the browser chrome blends in. */
export function koreThemeColor(theme: ThemeId): string {
  return KORE_THEMES[theme].bg;
}

export type KoreThemeColor = keyof ThemePalette;

export type ThemeInitOptions = {
  storageKey?: string;
  /** The theme used when nothing is stored. Default "color". */
  defaultTheme?: ThemePreference;
  /** The theme "system" resolves to when the OS is dark. Default "color". (A light OS always gets "light".) */
  systemDarkTheme?: Exclude<ThemeId, "light">;
};

/**
 * A tiny inline script that sets `data-theme` on `<html>` before the first paint, so a stored Light or Dark choice
 * never flashes the Color theme. Put it in `<head>` before any stylesheet that matters; the arguments must match
 * what you pass to `KoreProvider`. Next: `<script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />` and
 * `suppressHydrationWarning` on `<html>`. Vite: paste the string into `index.html`.
 */
export function themeInitScript({ storageKey = THEME_STORAGE_KEY, defaultTheme = "color", systemDarkTheme = "color" }: ThemeInitOptions = {}): string {
  return (
    "(function(){try{" +
    `var p=localStorage.getItem(${JSON.stringify(storageKey)})||${JSON.stringify(defaultTheme)};` +
    "var t=p;" +
    `if(p==="system"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":${JSON.stringify(systemDarkTheme)}}` +
    'if(t!=="light"&&t!=="dark"&&t!=="color")t=' +
    JSON.stringify(defaultTheme === "system" ? "color" : defaultTheme) +
    ";" +
    'document.documentElement.setAttribute("data-theme",t)' +
    '}catch(e){document.documentElement.setAttribute("data-theme",' +
    JSON.stringify(defaultTheme === "system" ? "color" : defaultTheme) +
    ")}})()"
  );
}
