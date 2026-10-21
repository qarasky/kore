import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined,
  }),
}));

import { api, API_TIMEOUT_MS, API_UNREACHABLE_DIGEST, ApiError, apiText } from "../api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api()", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    cookieStore.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.API_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards cookie on server calls", async () => {
    process.env.API_URL = "http://api.internal:9000";
    cookieStore.set("kore_session", "tok123");
    cookieStore.set("other", "ignored");
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "u1", email: "a@b.c" }));

    const me = await api<{ id: string; email: string }>("/api/auth/me");

    expect(me).toEqual({ id: "u1", email: "a@b.c" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://api.internal:9000/api/auth/me");
    const headers = new Headers(init?.headers);
    expect(headers.get("cookie")).toBe("kore_session=tok123");
    expect(init?.cache).toBe("no-store");
  });

  it("uses the default API_URL and sends no cookie when there is no session", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    await api("/api/nodes?space=personal");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:8080/api/nodes?space=personal");
    expect(new Headers(init?.headers).has("cookie")).toBe(false);
  });

  it("keeps caller headers and sets JSON content type for string bodies", async () => {
    cookieStore.set("kore_session", "tok");
    fetchMock.mockResolvedValue(jsonResponse(201, { id: "n1" }));

    await api("/api/nodes", {
      method: "POST",
      body: JSON.stringify({ name: "x" }),
      headers: { "X-Test": "1" },
    });

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("x-test")).toBe("1");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("cookie")).toBe("kore_session=tok");
  });

  it("maps 401 to ApiError", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));

    const err = await api("/api/auth/me").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).code).toBe("unauthorized");
  });

  it("keeps the rest of a JSON error body as details", async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: "user_has_files", file_count: 4, shared_count: 1 }));

    const err = await api("/api/admin/users/x", { method: "DELETE" }).catch((e: unknown) => e);

    expect((err as ApiError).code).toBe("user_has_files");
    expect((err as ApiError).details).toMatchObject({ file_count: 4, shared_count: 1 });
  });

  it("falls back to an http_<status> code when the body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("bad gateway", { status: 502 }));

    const err = await api("/api/auth/me").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).code).toBe("http_502");
  });

  it("returns undefined for 204 responses", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(api("/api/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("calls same-origin /api from the browser without touching cookies", async () => {
    vi.stubGlobal("window", {});
    process.env.API_URL = "http://api.internal:9000";
    cookieStore.set("kore_session", "tok123");
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    await api("/api/auth/me");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/auth/me");
    expect(new Headers(init?.headers).has("cookie")).toBe(false);
    expect(init?.credentials).toBe("same-origin");
  });

  it("wraps network failures as ApiError(503, unreachable)", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const err = await api("/api/auth/me").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(503);
    expect((err as ApiError).code).toBe("unreachable");
    expect((err as ApiError).digest).toBe(API_UNREACHABLE_DIGEST);
  });

  it("times out server calls after API_TIMEOUT_MS as ApiError(503, unreachable)", async () => {
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => realTimeout(20));
    // A fetch that hangs until its signal aborts, like a stalled API.
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) return reject(signal.reason);
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    );

    const err = await api("/api/auth/me").catch((e: unknown) => e);

    expect(timeoutSpy).toHaveBeenCalledWith(API_TIMEOUT_MS);
    expect(API_TIMEOUT_MS).toBe(10_000);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(503);
    expect((err as ApiError).code).toBe("unreachable");
    timeoutSpy.mockRestore();
  });

  it("composes the timeout with the caller's signal and rethrows a caller abort", async () => {
    const ctrl = new AbortController();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) return reject(signal.reason);
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    );

    const pending = api("/api/auth/me", { signal: ctrl.signal }).catch((e: unknown) => e);
    ctrl.abort();
    const err = await pending;

    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as Error).name).toBe("AbortError");
  });

  it("returns undefined for an empty 200 body", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));

    await expect(api("/api/x")).resolves.toBeUndefined();
  });

  it("throws ApiError(502, bad_response) for a non-empty non-JSON 2xx body", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>proxy page</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const err = await api("/api/x").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).code).toBe("bad_response");
  });

  it("throws ApiError(502, bad_response) for malformed JSON", async () => {
    fetchMock.mockResolvedValue(
      new Response("{not json", { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const err = await api("/api/x").catch((e: unknown) => e);

    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).code).toBe("bad_response");
  });

  it("rejects paths outside /api/", async () => {
    await expect(api("https://evil.com/api/x")).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("apiText()", () => {
  const fetchMock = vi.fn<typeof fetch>();

  function textResponse(body: string, headers: Record<string, string> = {}, status = 200): Response {
    return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });
  }

  beforeEach(() => {
    cookieStore.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.API_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the body as text and asks for text/plain", async () => {
    fetchMock.mockResolvedValue(textResponse("<script>x</script>\nline 2"));

    const got = await apiText("/api/nodes/n1/preview");

    expect(got).toEqual({ text: "<script>x</script>\nline 2", truncated: false });
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get("accept")).toBe("text/plain");
  });

  it("reports X-Truncated", async () => {
    fetchMock.mockResolvedValue(textResponse("abc", { "X-Truncated": "true" }));

    await expect(apiText("/api/nodes/n1/preview")).resolves.toEqual({ text: "abc", truncated: true });
  });

  it("returns an empty file as empty text", async () => {
    fetchMock.mockResolvedValue(textResponse(""));

    await expect(apiText("/api/nodes/n1/preview")).resolves.toEqual({ text: "", truncated: false });
  });

  it("forwards the session cookie and uses API_URL on the server", async () => {
    process.env.API_URL = "http://api.internal:9000/";
    cookieStore.set("kore_session", "tok123");
    fetchMock.mockResolvedValue(textResponse("hi"));

    await apiText("/api/nodes/n1/preview");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://api.internal:9000/api/nodes/n1/preview");
    expect(new Headers(init?.headers).get("cookie")).toBe("kore_session=tok123");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("calls same-origin from the browser", async () => {
    vi.stubGlobal("window", {});
    fetchMock.mockResolvedValue(textResponse("hi"));

    await apiText("/api/nodes/n1/preview");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/nodes/n1/preview");
    expect(init?.credentials).toBe("same-origin");
  });

  it("maps JSON errors (415 not_text, 404) to ApiError", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(415, { error: "not_text" }));
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "not_found" }));

    const e1 = await apiText("/api/nodes/n1/preview").catch((e: unknown) => e);
    const e2 = await apiText("/api/nodes/n1/preview").catch((e: unknown) => e);

    expect(e1).toBeInstanceOf(ApiError);
    expect((e1 as ApiError).status).toBe(415);
    expect((e1 as ApiError).code).toBe("not_text");
    expect((e2 as ApiError).status).toBe(404);
  });

  it("throws ApiError(502, bad_response) for a 2xx that is not text/plain", async () => {
    fetchMock.mockResolvedValue(new Response("<html>proxy</html>", { status: 200, headers: { "Content-Type": "text/html" } }));

    const err = await apiText("/api/x").catch((e: unknown) => e);

    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).code).toBe("bad_response");
  });

  it("wraps network failures and rethrows caller aborts", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const err = await apiText("/api/x").catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(503);
    expect((err as ApiError).code).toBe("unreachable");

    const ctrl = new AbortController();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) return reject(signal.reason);
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const pending = apiText("/api/x", { signal: ctrl.signal }).catch((e: unknown) => e);
    ctrl.abort();
    const aborted = await pending;
    expect(aborted).not.toBeInstanceOf(ApiError);
    expect((aborted as Error).name).toBe("AbortError");
  });

  it("rejects paths outside /api/", async () => {
    await expect(apiText("/nodes/x")).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
