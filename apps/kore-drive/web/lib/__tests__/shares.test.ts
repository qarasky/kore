import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import {
  defaultChoice,
  expiryDays,
  expiryText,
  forwardedClientHeaders,
  publicProblem,
  shareCookieHeader,
  sharePageHref,
  shareUrl,
  shareUrls,
  unlockErrorKey,
} from "../shares";

describe("shareUrls()", () => {
  const u = shareUrls("tok_-1");
  it("scopes every endpoint to the token; empty id = the shared item", () => {
    expect(u.download("")).toBe("/api/public/shares/tok_-1/download");
    expect(u.download("a b")).toBe("/api/public/shares/tok_-1/download?node=a%20b");
    expect(u.view("x")).toBe("/api/public/shares/tok_-1/view?node=x");
    expect(u.text("")).toBe("/api/public/shares/tok_-1/preview");
    expect(u.zip("d")).toBe("/api/public/shares/tok_-1/zip?node=d");
    expect(u.children("f")).toBe("/api/public/shares/tok_-1/children?folder=f");
    expect(u.unlock).toBe("/api/public/shares/tok_-1/unlock");
  });
  it("encodes hostile ids and tokens", () => {
    expect(shareUrls("../x").download("../../nodes")).toBe("/api/public/shares/..%2Fx/download?node=..%2F..%2Fnodes");
  });
  it("builds page links", () => {
    expect(sharePageHref("t")).toBe("/s/t");
    expect(sharePageHref("t", "f&x")).toBe("/s/t?folder=f%26x");
    expect(shareUrl("https://files.example/", "t")).toBe("https://files.example/s/t");
  });
});

describe("expiry", () => {
  const now = 1_000_000;
  it("describes the time left", () => {
    expect(expiryText(null, now)).toBe("Never expires");
    expect(expiryText(now, now)).toBe("Expired");
    expect(expiryText(now + 3 * 86400, now)).toBe("Expires in 3 days");
    expect(expiryText(now + 86400 + 5, now)).toBe("Expires in 1 day");
    expect(expiryText(now + 5 * 3600, now)).toBe("Expires in 5 hours");
    expect(expiryText(now + 600, now)).toBe("Expires in less than 2 hours");
  });
  it("maps choices and defaults", () => {
    expect(expiryDays("never")).toBeNull();
    expect(expiryDays("30")).toBe(30);
    expect(defaultChoice(0)).toBe("never");
    expect(defaultChoice(1)).toBe("1");
    expect(defaultChoice(30)).toBe("30");
    expect(defaultChoice(14)).toBe("7");
  });
});

describe("errors", () => {
  it("maps public API errors to page states without distinguishing unknown and unavailable", () => {
    expect(publicProblem(new ApiError(404, "not_found"))).toBe("gone");
    expect(publicProblem(new ApiError(410, "unavailable"))).toBe("gone");
    expect(publicProblem(new ApiError(410, "expired"))).toBe("expired");
    expect(publicProblem(new ApiError(410, "revoked"))).toBe("revoked");
    expect(publicProblem(new ApiError(403, "shares_disabled"))).toBe("disabled");
    expect(publicProblem(new ApiError(429, "rate_limited"))).toBe("rateLimited");
    expect(publicProblem(new Error("x"))).toBe("error");
  });
  it("maps unlock errors", () => {
    expect(unlockErrorKey(new ApiError(403, "wrong_password"))).toBe("publicShare.wrongPassword");
    expect(unlockErrorKey(new ApiError(429, "too_many_attempts"))).toBe("publicShare.tooManyAttempts");
  });
});

describe("shareCookieHeader()", () => {
  it("forwards only well-formed share unlock cookies, never the session", () => {
    expect(
      shareCookieHeader([
        { name: "kore_session", value: "secret" },
        { name: "kore_share_abc123", value: "1700000000.abcdef" },
        { name: "kore_share_bad", value: "x;y=z" },
        { name: "kore_share_x;", value: "1.ab" },
        { name: "other", value: "1" },
      ]),
    ).toBe("kore_share_abc123=1700000000.abcdef");
  });
});

describe("forwardedClientHeaders()", () => {
  const from = (h: Record<string, string>) => forwardedClientHeaders((n) => h[n]);
  it("forwards the visitor's address from Cloudflare and the proxy chain", () => {
    expect(from({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "10.0.0.1, 198.51.100.7" })).toEqual({
      "cf-connecting-ip": "198.51.100.7",
      "x-forwarded-for": "10.0.0.1, 198.51.100.7",
    });
    expect(from({ "x-forwarded-for": "2001:db8::1" })).toEqual({ "x-forwarded-for": "2001:db8::1" });
  });
  it("sends nothing when there is nothing, and drops junk (no header injection)", () => {
    expect(from({})).toEqual({});
    expect(from({ "cf-connecting-ip": "evil\r\nx: y", "x-forwarded-for": "junk, <script>, 203.0.113.9" })).toEqual({
      "x-forwarded-for": "203.0.113.9",
    });
  });
});
