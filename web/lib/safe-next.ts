/** Where users land after login when no (valid) `next` is given. */
export const DEFAULT_LANDING = "/files";

const PROBE_ORIGIN = "http://kore.invalid";

/**
 * Returns `raw` if it is a same-origin relative path that is safe to redirect
 * to after login, otherwise {@link DEFAULT_LANDING}.
 *
 * Rejects absolute URLs, protocol-relative `//host`, anything with a
 * backslash (browsers treat `\` like `/`), control characters and whitespace
 * (browsers strip tabs/newlines, turning `/\t/evil.com` into `//evil.com`),
 * and the login page itself.
 */
export function safeNext(raw: string | string[] | null | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_LANDING;
  }
  if (/[\\\s\u0000-\u001f\u007f]/.test(value)) {
    return DEFAULT_LANDING;
  }
  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return DEFAULT_LANDING;
  }
  if (url.origin !== PROBE_ORIGIN) {
    return DEFAULT_LANDING;
  }
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) {
    return DEFAULT_LANDING;
  }
  return value;
}
