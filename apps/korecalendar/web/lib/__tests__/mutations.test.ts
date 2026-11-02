import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sendRequest } from "@/lib/mutations";

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
