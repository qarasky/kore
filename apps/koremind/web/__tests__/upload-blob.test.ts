import { afterEach, expect, test } from "bun:test";
import { createApi } from "../lib/api";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("an attachment is fetched with the Authorization header, never a token in the URL", async () => {
  let seen: { url: string; auth: string | null } | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen = { url: String(input), auth: new Headers(init?.headers).get("authorization") };
    return new Response(new Blob(["png"], { type: "image/png" }));
  }) as typeof fetch;
  const api = createApi("https://api.example", () => "tok-123");
  const blob = await api.uploadBlob("att-1");
  expect(seen!.url).toBe("https://api.example/uploads/att-1");
  expect(seen!.url).not.toContain("tok-123");
  expect(seen!.auth).toBe("Bearer tok-123");
  expect(blob.type).toBe("image/png");
});

test("a failed attachment fetch rejects", async () => {
  globalThis.fetch = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
  const api = createApi("https://api.example", () => "tok");
  expect(api.uploadBlob("x")).rejects.toThrow();
});
