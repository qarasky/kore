/**
 * Isomorphic client for the Kore Go API.
 *
 * - On the server (Server Components, Route Handlers, Server Functions) it
 *   calls `API_URL` directly and forwards the incoming `kore_session` cookie,
 *   so SSR pages fetch data as the logged-in user.
 * - In the browser it calls the same-origin `/api/...` path (Caddy in
 *   production, the `next.config` rewrite in development).
 *
 * Non-2xx responses throw an {@link ApiError} carrying the HTTP status and the
 * API's machine-readable `error` code.
 */

export const SESSION_COOKIE = "kore_session";
export const DEFAULT_API_URL = "http://127.0.0.1:8080";
/** Server-side calls give up after this long and report the API unreachable. */
export const API_TIMEOUT_MS = 10_000;
/**
 * Digest stamped on "API unreachable" errors. Next keeps an existing `digest`
 * when a Server Component throws, and it is the only error detail that
 * reaches error boundaries in production, so `app/error.tsx` keys off it.
 */
export const API_UNREACHABLE_DIGEST = "kore:api-unreachable";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly digest?: string;

  constructor(status: number, code: string) {
    super(`API ${status}: ${code}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
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

async function errorCode(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // Not JSON (e.g. a proxy error page); fall through.
  }
  return `http_${res.status}`;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith("/api/")) {
    throw new TypeError(`api(): path must start with /api/, got ${JSON.stringify(path)}`);
  }

  const headers = new Headers(init.headers);
  if (typeof init.body === "string" && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
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
    throw new ApiError(res.status, await errorCode(res));
  }

  let text: string;
  try {
    text = res.status === 204 ? "" : await res.text();
  } catch {
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
