import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "../../proxy";
import { redirectTo } from "../redirect";

function req(path: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(path, "http://internal:3000"), {
    headers: cookie ? { cookie } : {},
  });
}

/** Location as the browser receives it: Next's proxy adapter relativizes
 *  any Location whose host equals the request's (see lib/redirect.ts). */
function sentLocation(res: Response, request: NextRequest): string | null {
  const loc = res.headers.get("location");
  if (loc === null) return null;
  const u = new URL(loc);
  expect(u.origin, "redirect must stay on the request's origin").toBe(request.nextUrl.origin);
  return u.pathname + u.search;
}

describe("redirectTo()", () => {
  it("redirects (307) to the path on the request's own origin", () => {
    const r = req("/files");
    const res = redirectTo(r, "/login?next=%2Ffiles");
    expect(res.status).toBe(307);
    expect(sentLocation(res, r)).toBe("/login?next=%2Ffiles");
  });

  it("refuses non-relative targets", () => {
    const r = req("/files");
    expect(() => redirectTo(r, "https://evil.com")).toThrow(TypeError);
    expect(() => redirectTo(r, "//evil.com")).toThrow(TypeError);
    expect(() => redirectTo(r, "/\\evil.com")).toThrow(TypeError);
  });
});

describe("proxy()", () => {
  it("sends anonymous users to login on the request origin", () => {
    const r = req("/files/abc?x=1");
    const res = proxy(r);
    expect(res.status).toBe(307);
    expect(sentLocation(res, r)).toBe(
      `/login?next=${encodeURIComponent("/files/abc?x=1")}`,
    );
  });

  it("sends logged-in users away from /login to a sanitized next", () => {
    for (const [path, expected] of [
      ["/login", "/files"],
      ["/login?next=%2Ffiles%2Fa", "/files/a"],
      ["/login?next=%2F%2Fevil.com", "/files"],
    ]) {
      const r = req(path, "kore_session=t");
      expect(sentLocation(proxy(r), r)).toBe(expected);
    }
  });

  it("shows /login?expired=1 even with a cookie", () => {
    const res = proxy(req("/login?expired=1", "kore_session=t"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("passes authenticated requests through with the path header", () => {
    const res = proxy(req("/files/abc?x=1", "kore_session=t"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-request-x-kore-path")).toBe("/files/abc?x=1");
  });
});
