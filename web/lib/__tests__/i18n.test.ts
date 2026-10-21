import { describe, expect, it } from "vitest";
import { t } from "../i18n";
import en from "../i18n/en";

describe("t()", () => {
  it("returns the English string for a key", () => {
    expect(t("login.title")).toBe(en["login.title"]);
  });

  it("fills placeholders", () => {
    expect(t("files.signedInAs", { email: "a@b.c" })).toBe("Signed in as a@b.c");
  });

  it("leaves unknown placeholders intact", () => {
    expect(t("files.signedInAs", {})).toBe("Signed in as {email}");
  });
});
