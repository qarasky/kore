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

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`API ${status}: ${code}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
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
  } else {
    url = path;
    req.credentials = "same-origin";
  }

  const res = await fetch(url, req);
  if (!res.ok) {
    throw new ApiError(res.status, await errorCode(res));
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    return (await res.text()) as T;
  }
  return (await res.json()) as T;
}
