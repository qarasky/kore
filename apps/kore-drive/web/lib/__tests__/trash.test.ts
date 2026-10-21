import { describe, expect, it } from "vitest";
import { trashHref, trashSpace } from "../trash";

describe("trash tabs", () => {
  it("maps ?space= to a tab and back", () => {
    expect(trashSpace(undefined)).toBe("personal");
    expect(trashSpace("shared")).toBe("shared");
    expect(trashSpace(["shared", "x"])).toBe("personal");
    expect(trashSpace("other")).toBe("personal");
    expect(trashHref("shared")).toBe("/trash?space=shared");
    expect(trashHref("personal")).toBe("/trash");
  });
});
