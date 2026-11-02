import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "korecal_session" ? { value: "tok123" } : undefined) }),
}));

import { api, ApiError, isApiError } from "@/lib/api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { "content-type": "application/json" },
  });
}

describe("api()", () => {
  const realFetch = globalThis.fetch;
  let calls: { url: string; init: RequestInit }[];
  let reply: () => Promise<Response>;

  beforeEach(() => {
    calls = [];
    reply = async () => jsonResponse(200, { ok: true });
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return reply();
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllGlobals();
    delete (globalThis as { window?: unknown }).window;
  });

  it("calls the API directly with the session cookie on the server", async () => {
    process.env.API_URL = "http://api.internal:8080/";
    await api("/api/me");
    expect(calls[0].url).toBe("http://api.internal:8080/api/me");
    expect(new Headers(calls[0].init.headers).get("cookie")).toBe("korecal_session=tok123");
    expect(calls[0].init.cache).toBe("no-store");
  });

  it("uses the same-origin path with credentials in the browser", async () => {
    (globalThis as { window?: unknown }).window = {};
    await api("/api/me");
    expect(calls[0].url).toBe("/api/me");
    expect(calls[0].init.credentials).toBe("same-origin");
  });

  it("sends JSON bodies with a content type", async () => {
    await api("/api/events", { method: "POST", body: JSON.stringify({ title: "x" }) });
    expect(new Headers(calls[0].init.headers).get("content-type")).toBe("application/json");
  });

  it("turns the API's error body into an ApiError with code and retryAfterSec", async () => {
    reply = async () => jsonResponse(429, { error: { code: "rate_limited", message: "slow down", retryAfterSec: 900 } });
    const err = await api("/api/login", { method: "POST", body: "{}" }).catch((e) => e);
    expect(isApiError(err, 429)).toBe(true);
    expect(err).toMatchObject({ status: 429, code: "rate_limited", retryAfterSec: 900 });
  });

  it("falls back to http_<status> when the error is not JSON", async () => {
    reply = async () => new Response("<html>bad gateway</html>", { status: 502 });
    const err = await api("/api/me").catch((e) => e);
    expect(err).toMatchObject({ status: 502, code: "http_502" });
  });

  it("reports a network failure as an unreachable server", async () => {
    reply = async () => {
      throw new TypeError("fetch failed");
    };
    const err = await api("/api/me").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 503, code: "unreachable" });
  });

  it("returns undefined for 204 and refuses non-/api paths", async () => {
    reply = async () => new Response(null, { status: 204 });
    expect(await api("/api/logout", { method: "POST" })).toBeUndefined();
    await expect(api("/etc/passwd")).rejects.toThrow(TypeError);
  });

  it("rejects a 200 that is not JSON", async () => {
    reply = async () => new Response("hello", { status: 200, headers: { "content-type": "text/plain" } });
    await expect(api("/api/me")).rejects.toMatchObject({ code: "bad_response" });
  });
});
