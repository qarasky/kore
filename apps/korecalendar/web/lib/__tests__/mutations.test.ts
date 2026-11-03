import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sendRequest, signOut } from "@/lib/mutations";

describe("sendRequest", () => {
  const realFetch = globalThis.fetch;
  let calls: { url: string; init: RequestInit }[];

  beforeEach(() => {
    calls = [];
    (globalThis as { window?: unknown }).window = {}; // browser: same-origin, no cookie lookup
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "e1" }), { status: 201, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete (globalThis as { window?: unknown }).window;
  });

  it("sends the Idempotency-Key a request carries", async () => {
    await sendRequest({ method: "POST", path: "/api/events", body: { title: "x" }, idempotencyKey: "key-1" });
    expect(new Headers(calls[0].init.headers).get("Idempotency-Key")).toBe("key-1");
  });

  it("sends none when the request has no key, and If-Match as before", async () => {
    await sendRequest({ method: "PATCH", path: "/api/events/e1", body: { title: "y" }, ifMatch: 4 });
    const h = new Headers(calls[0].init.headers);
    expect(h.get("Idempotency-Key")).toBeNull();
    expect(h.get("If-Match")).toBe('"4"');
  });
});

describe("signOut", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete (globalThis as { window?: unknown }).window;
  });

  it("returns null for a token session (204)", async () => {
    globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
    expect(await signOut()).toBeNull();
  });

  it("returns the Kore ID end-session URL so the browser can follow it", async () => {
    const url = "https://id.example.com/logout?id_token_hint=x";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ end_session_url: url }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    expect(await signOut()).toBe(url);
  });

  it("never follows a non-http(s) URL", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ end_session_url: "javascript:alert(1)" }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    expect(await signOut()).toBeNull();
  });
});
