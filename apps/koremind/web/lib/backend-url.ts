/** Turns what a person types into a base URL, or null when it can't be one. */
export function normalizeBackendUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let u: URL;
  try { u = new URL(withScheme); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname || /\s/.test(u.hostname)) return null;
  return (u.origin + u.pathname).replace(/\/+$/, "");
}
