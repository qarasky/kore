import { describe, expect, it } from "vitest";
import { adminErrorKey, parseRetentionDays } from "../admin";
import { ApiError } from "../api";

describe("parseRetentionDays", () => {
  it("accepts whole days from 1 to 3650", () => {
    expect(parseRetentionDays("1")).toBe(1);
    expect(parseRetentionDays(" 30 ")).toBe(30);
    expect(parseRetentionDays("3650")).toBe(3650);
  });
  it("rejects out-of-range and non-integers", () => {
    for (const bad of ["0", "3651", "-1", "1.5", "", "abc", "1e2"]) expect(parseRetentionDays(bad), bad).toBeNull();
  });
});

describe("adminErrorKey", () => {
  it("maps API codes to messages", () => {
    expect(adminErrorKey(new ApiError(409, "last_admin"))).toBe("admin.error.lastAdmin");
    expect(adminErrorKey(new ApiError(409, "cannot_delete_self"))).toBe("admin.error.cannotDeleteSelf");
    expect(adminErrorKey(new ApiError(409, "email_in_use"))).toBe("admin.error.emailInUse");
    expect(adminErrorKey(new ApiError(403, "wrong_password"))).toBe("account.error.wrongPassword");
    expect(adminErrorKey(new ApiError(429, "too_many_attempts"))).toBe("account.error.rateLimited");
    expect(adminErrorKey(new ApiError(400, "invalid_trash_retention_days"))).toBe("settings.error.retention");
  });
  it("falls back for outages and unknown errors", () => {
    expect(adminErrorKey(new ApiError(503, "unreachable"))).toBe("admin.error.unreachable");
    expect(adminErrorKey(new ApiError(500, "internal"))).toBe("admin.error.generic");
    expect(adminErrorKey(new Error("x"))).toBe("admin.error.generic");
  });
  it("keeps extra fields of the error body", () => {
    const e = new ApiError(409, "user_has_files", { error: "user_has_files", file_count: 3 });
    expect(e.details?.file_count).toBe(3);
  });
});
