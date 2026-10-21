import { NextResponse, type NextRequest } from "next/server";

/**
 * A 307 redirect from the proxy to a same-origin relative `location`.
 *
 * Next's proxy adapter requires an absolute Location (it parses it with
 * `new URL`), and rewrites any Location whose host matches the request's into
 * a relative one before sending it. So we resolve against the request's own
 * URL: the browser receives a relative `Location: /login?...` and resolves it
 * against the URL it actually used, which keeps redirects correct behind
 * Caddy / Cloudflare where Next only sees an internal host over plain http.
 */
export function redirectTo(req: NextRequest, location: string): NextResponse {
  if (!location.startsWith("/") || location.startsWith("//") || location.includes("\\")) {
    throw new TypeError(`redirectTo(): relative path required, got ${JSON.stringify(location)}`);
  }
  return NextResponse.redirect(new URL(location, req.url), 307);
}
