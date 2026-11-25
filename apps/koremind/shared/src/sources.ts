// Search sources of an answer. Engines often report the same page more than once (with tracking parameters,
// a trailing slash, or simply twice), so sources are de-duplicated before they are stored or shown.
// Kept 1:1 with android data/Sources.kt.

type Src = { title: string; url: string };

const TRACKING = /^(utm_.*|ref|ref_src|fbclid|gclid|yclid|mc_cid|mc_eid|srsltid)$/i;

/** The same page gives the same key: host without www, no fragment, no tracking parameters, no trailing slash. */
export function sourceKey(url: string): string {
  try {
    const u = new URL(url.trim());
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&") : "";
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${path}${query}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

const host = (url: string) => sourceKey(url).split(/[/?]/)[0];
const titleKey = (s: Src) => `${host(s.url)}|${s.title.trim().toLowerCase()}`;

/** True when [s] is a page already in [list]: same address, or the same title on the same site. */
export function hasSource(list: Src[], s: Src): boolean {
  const k = sourceKey(s.url);
  const t = titleKey(s);
  return list.some((x) => sourceKey(x.url) === k || (s.title.trim() !== "" && titleKey(x) === t));
}

/** [list] plus [s], unless it is already there. */
export const addSource = <T extends Src>(list: T[], s: T): T[] => (hasSource(list, s) ? list : [...list, s]);

/** [list] without repeats, first occurrence kept, order kept. */
export const dedupeSources = <T extends Src>(list: T[]): T[] => list.reduce<T[]>(addSource, []);

/** The site a source is on, for the list: "runpod.io". */
export const sourceHost = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
};
