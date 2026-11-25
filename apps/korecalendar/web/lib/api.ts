/**
 * Isomorphic client for the KoreCalendar Go API.
 *
 * - On the server (Server Components, Route Handlers) it calls `API_URL`
 *   directly and forwards the incoming `korecal_session` cookie, so SSR pages
 *   fetch data as the signed-in user.
 * - In the browser it calls the same-origin `/api/...` path (Caddy in
 *   production, the `next.config` rewrite in development), with cookies.
 *
 * Non-2xx responses throw an {@link ApiError} carrying the HTTP status and the
 * API's machine-readable `error.code`.
 */

export const SESSION_COOKIE = "korecal_session";
export const DEFAULT_API_URL = "http://127.0.0.1:8080";
/** Server-side calls give up after this long and report the API unreachable. */
export const API_TIMEOUT_MS = 10_000;
/**
 * Digest stamped on "API unreachable" errors. Next keeps an existing `digest`
 * when a Server Component throws, and it is the only error detail that
 * reaches error boundaries in production, so `app/error.tsx` keys off it.
 */
export const API_UNREACHABLE_DIGEST = "korecal:api-unreachable";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec?: number;
  readonly digest?: string;

  constructor(status: number, code: string, retryAfterSec?: number) {
    super(`API ${status}: ${code}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
    if (status === 503 && code === "unreachable") {
      this.digest = API_UNREACHABLE_DIGEST;
    }
  }
}

export function isApiError(e: unknown, status?: number): e is ApiError {
  return e instanceof ApiError && (status === undefined || e.status === status);
}

function isServer(): boolean {
  return typeof window === "undefined";
}

function apiBase(): string {
  return (process.env.API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

async function sessionCookie(): Promise<string | undefined> {
  // Imported lazily so this module stays usable from Client Components.
  const { cookies } = await import("next/headers");
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body) {
      const e = (body as { error: unknown }).error;
      if (e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string") {
        const { code, retryAfterSec } = e as { code: string; retryAfterSec?: unknown };
        return new ApiError(res.status, code, typeof retryAfterSec === "number" ? retryAfterSec : undefined);
      }
    }
  } catch {
    // Not JSON (e.g. a proxy error page); fall through.
  }
  // The API always answers in its own JSON shape, even for its 500s. A bare
  // 5xx is the proxy in front of it (Next's rewrite, Caddy) saying it couldn't
  // connect: the same situation as a refused connection.
  if (res.status >= 500 && res.status <= 504) return new ApiError(503, "unreachable");
  return new ApiError(res.status, `http_${res.status}`);
}

/** Sends the request (cookie, timeout, same-origin rules) and returns a 2xx
 *  response; anything else becomes an {@link ApiError}. */
async function send(path: string, init: RequestInit, accept: string): Promise<Response> {
  if (!path.startsWith("/api/")) {
    throw new TypeError(`api(): path must start with /api/, got ${JSON.stringify(path)}`);
  }

  const headers = new Headers(init.headers);
  if (typeof init.body === "string" && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (!headers.has("accept")) {
    headers.set("accept", accept);
  }

  let url: string;
  const req: RequestInit = { ...init, headers };
  if (isServer()) {
    url = apiBase() + path;
    const tok = await sessionCookie();
    if (tok) {
      headers.set("cookie", `${SESSION_COOKIE}=${tok}`);
    }
    req.cache = "no-store";
    const timeout = AbortSignal.timeout(API_TIMEOUT_MS);
    req.signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  } else {
    url = path;
    req.credentials = "same-origin";
  }

  let res: Response;
  try {
    res = await fetch(url, req);
  } catch (e) {
    // A caller-initiated abort is not an outage; let it propagate as-is.
    if (init.signal?.aborted) throw e;
    // Connection refused/reset, DNS failure, or our timeout.
    throw new ApiError(503, "unreachable");
  }
  if (!res.ok) {
    throw await toError(res);
  }
  return res;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await send(path, init, "application/json");
  let text: string;
  try {
    text = res.status === 204 ? "" : await res.text();
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new ApiError(503, "unreachable");
  }
  if (text === "") {
    return undefined as T;
  }
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) {
    throw new ApiError(502, "bad_response");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(502, "bad_response");
  }
}

/** Fetches a text body (the `.ics` export). Same cookie and error handling. */
export async function apiText(path: string, init: RequestInit = {}): Promise<string> {
  const res = await send(path, init, "text/calendar");
  return res.text();
}
