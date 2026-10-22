/**
 * Server-side reads of a public share for the `/s/[token]` page. Unlike
 * `api()`, these never send the `kore_session` cookie: only the share
 * unlock cookies (`kore_share_*`) are forwarded, so the public page renders
 * exactly what an anonymous visitor may see. The visitor's address is
 * forwarded (`forwardedClientHeaders`) so rate limits apply per visitor.
 */
import { cookies, headers as requestHeaders } from "next/headers";
import { API_TIMEOUT_MS, ApiError, DEFAULT_API_URL } from "./api";
import { forwardedClientHeaders, publicBase, shareCookieHeader, shareUrls, type PublicListing, type PublicMeta } from "./shares";

async function publicGet<T>(path: string): Promise<T> {
  const base = (process.env.API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
  const incoming = await requestHeaders();
  const headers = new Headers({ accept: "application/json", ...forwardedClientHeaders((n) => incoming.get(n)) });
  const cookie = shareCookieHeader((await cookies()).getAll());
  if (cookie) headers.set("cookie", cookie);
  let res: Response;
  try {
    res = await fetch(base + path, { headers, cache: "no-store", signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  } catch {
    throw new ApiError(503, "unreachable");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // fall through
  }
  if (!res.ok) {
    const code = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : `http_${res.status}`;
    throw new ApiError(res.status, code);
  }
  return body as T;
}

export function getPublicMeta(token: string): Promise<PublicMeta> {
  return publicGet<PublicMeta>(publicBase(token));
}

export function getPublicListing(token: string, folder: string): Promise<PublicListing> {
  return publicGet<PublicListing>(shareUrls(token).children(folder));
}
