/** Request header set by `proxy.ts` with the original path + query, so Server
 *  Components can send the user back to it after a re-login. */
export const PATH_HEADER = "x-kore-path";

/** Login URL that returns to `next` afterwards. `expired` marks a session the
 *  API rejected; the proxy then shows the login page even though a (stale)
 *  cookie is still present, instead of bouncing back to `/files`. */
export function loginUrl(next: string, expired = false): string {
  const q = new URLSearchParams({ next });
  if (expired) q.set("expired", "1");
  return `/login?${q.toString()}`;
}
