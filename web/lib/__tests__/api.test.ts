import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined,
  }),
}));

import { api, ApiError } from "../api";

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

  it("rejects paths outside /api/", async () => {
    await expect(api("https://evil.com/api/x")).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
