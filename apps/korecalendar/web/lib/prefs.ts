/**
 * Display preferences, kept in cookies so Server Components can read them
 * (no flash of the wrong week start or clock). Written from the browser.
 */
import type { Clock, View, WeekStart } from "./types";
import { VIEWS } from "./types";

export const PREF_COOKIES = {
  view: "kc_view",
  weekStart: "kc_weekstart",
  clock: "kc_clock",
  hidden: "kc_hidden",
} as const;

export type Prefs = { view: View; weekStart: WeekStart; clock: Clock; hidden: string[] };

export const DEFAULT_PREFS: Prefs = { view: "week", weekStart: "mon", clock: "24h", hidden: [] };

type Reader = (name: string) => string | undefined;

/** Builds {@link Prefs} from any cookie reader, ignoring invalid values. */
export function prefsFrom(read: Reader): Prefs {
  const view = read(PREF_COOKIES.view);
  const weekStart = read(PREF_COOKIES.weekStart);
  const clock = read(PREF_COOKIES.clock);
  const hidden = read(PREF_COOKIES.hidden);
  return {
    view: (VIEWS as readonly string[]).includes(view ?? "") ? (view as View) : DEFAULT_PREFS.view,
    weekStart: weekStart === "mon" || weekStart === "sun" || weekStart === "sat" ? weekStart : DEFAULT_PREFS.weekStart,
    clock: clock === "12h" || clock === "24h" ? clock : DEFAULT_PREFS.clock,
    hidden: hidden ? hidden.split(",").filter((id) => /^[a-f0-9]{8,64}$/.test(id)) : [],
  };
}

/** Parses a `Cookie:` header or `document.cookie` string. */
export function readPrefs(cookieString: string): Prefs {
  const jar = new Map<string, string>();
  for (const part of cookieString.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) jar.set(part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim()));
  }
  return prefsFrom((n) => jar.get(n));
}

/** Browser only: stores one preference for a year. */
export function writePref(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}
