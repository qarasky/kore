import { describe, expect, it } from "vitest";
import { accountSsoMessage, loginSsoError } from "../ssoErrors";

describe("loginSsoError()", () => {
  it("is null without an error", () => {
    expect(loginSsoError(undefined)).toBeNull();
    expect(loginSsoError("")).toBeNull();
  });
  it("maps known codes", () => {
    expect(loginSsoError("sso_email_in_use")).toBe("login.sso.error.emailInUse");
    expect(loginSsoError(["sso_denied", "x"])).toBe("login.sso.error.denied");
  });
  it("falls back to a generic message for unknown or hostile codes", () => {
    expect(loginSsoError("<script>")).toBe("login.sso.error.failed");
    expect(loginSsoError("constructor")).toBe("login.sso.error.failed");
  });
});

describe("accountSsoMessage()", () => {
  it("flags success", () => {
    expect(accountSsoMessage("linked")).toEqual({ key: "account.sso.linked", ok: true });
  });
  it("maps link errors", () => {
    expect(accountSsoMessage("sso_sub_taken")).toEqual({ key: "account.sso.error.subTaken", ok: false });
    expect(accountSsoMessage("zzz")).toEqual({ key: "login.sso.error.failed", ok: false });
    expect(accountSsoMessage(undefined)).toBeNull();
  });
});
