import { describe, expect, it } from "vitest";
import { checkLoginImageFile, loginImageError, loginImageSrc, MAX_LOGIN_IMAGE_BYTES } from "../branding";
import { ApiError } from "../api";

describe("loginImageSrc", () => {
  it("points at the API with the version when a custom picture is set", () => {
    expect(loginImageSrc({ login_image: true, version: 1729580000123 })).toBe(
      "/api/branding/login-image?v=1729580000123",
    );
  });
  it("is null without one, or when branding could not be loaded", () => {
    expect(loginImageSrc({ login_image: false, version: 5 })).toBeNull();
    expect(loginImageSrc(null)).toBeNull();
  });
  it("ignores a malformed version", () => {
    expect(loginImageSrc({ login_image: true, version: Number.NaN })).toBe("/api/branding/login-image?v=0");
  });
});

describe("checkLoginImageFile", () => {
  it.each([
    ["image/png", 1000, null],
    ["image/jpeg", MAX_LOGIN_IMAGE_BYTES, null],
    ["image/webp", 10, null],
    ["image/svg+xml", 10, "branding.error.type"],
    ["image/gif", 10, "branding.error.type"],
    ["text/html", 10, "branding.error.type"],
    ["", 10, "branding.error.type"],
    ["image/png", MAX_LOGIN_IMAGE_BYTES + 1, "branding.error.tooLarge"],
    ["image/png", 0, "branding.error.type"],
  ] as const)("%s, %d bytes -> %s", (type, size, want) => {
    expect(checkLoginImageFile({ type, size })).toBe(want);
  });
});

describe("loginImageError", () => {
  it("maps API errors to messages", () => {
    expect(loginImageError(new ApiError(415, "unsupported_image"))).toBe("branding.error.type");
    expect(loginImageError(new ApiError(413, "too_large"))).toBe("branding.error.tooLarge");
    expect(loginImageError(new ApiError(500, "internal"))).toBe("branding.error.generic");
    expect(loginImageError(new Error("x"))).toBe("branding.error.generic");
  });
});
