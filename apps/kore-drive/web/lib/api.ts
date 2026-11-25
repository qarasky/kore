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
  /** The parsed JSON error body, for replies that carry more than `error`
   *  (e.g. `file_count` on 409 `user_has_files`). */
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, details?: Record<string, unknown>) {
    super(`API ${status}: ${code}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
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
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      return new ApiError(res.status, body.error, body as Record<string, unknown>);
    }
  } catch {
    // Not JSON (e.g. a proxy error page); fall through.
  }
  return new ApiError(res.status, `http_${res.status}`);
}

/** Sends the request (cookie, timeout, same-origin rules) and returns a 2xx
 *  response; anything else becomes an {@link ApiError}. */
async function send(path: string, init: RequestInit, accept: string, fn: string): Promise<Response> {
  if (!path.startsWith("/api/")) {
    throw new TypeError(`${fn}(): path must start with /api/, got ${JSON.stringify(path)}`);
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

/** Reads the body; a connection dropped mid-body counts as unreachable
 *  (unless the caller aborted). */
async function readText(res: Response, signal?: AbortSignal | null): Promise<string> {
  try {
    return res.status === 204 ? "" : await res.text();
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError(503, "unreachable");
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await send(path, init, "application/json", "api");
  const text = await readText(res, init.signal);
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

export type TextBody = {
  text: string;
  /** The server cut the body short (`X-Truncated: true`). */
  truncated: boolean;
};

/**
 * Like {@link api} for endpoints that answer `text/plain` (the file preview).
 * Same cookie, timeout and error handling; a 2xx that is not `text/plain`
 * is a `502 bad_response`.
 */
export async function apiText(path: string, init: RequestInit = {}): Promise<TextBody> {
  const res = await send(path, init, "text/plain", "apiText");
  const text = await readText(res, init.signal);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "text/plain") {
    throw new ApiError(502, "bad_response");
  }
  return { text, truncated: res.headers.get("x-truncated")?.toLowerCase() === "true" };
}

/**
 * `HEAD` request: resolves when the API answers 2xx, else throws the
 * {@link ApiError} (status kept; a HEAD error has no body, so its code is
 * `http_<status>`). The preview uses it to ask `/view` whether a file can
 * be shown before pointing an `<img>`/`<iframe>` at it.
 */
export async function apiHead(path: string, init: RequestInit = {}): Promise<void> {
  await send(path, { ...init, method: "HEAD" }, "*/*", "apiHead");
}
