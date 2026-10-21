import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { canOpenFolder, destinationProblem, moveBody, moveDoneMessage, otherSpace, spaceLabel } from "../moveTo";
import en from "../i18n/en";

const from = { ids: ["f1", "d1"], names: { f1: "a.txt", d1: "Docs" }, space: "personal" as const, parentId: "p" };

describe("destinationProblem", () => {
  it("rejects where the items already are", () => {
    expect(destinationProblem(from, { space: "personal", path: ["p"] })).toBe("here");
    expect(destinationProblem({ ...from, parentId: null }, { space: "personal", path: [] })).toBe("here");
  });
  it("rejects a moved folder and anything inside it", () => {
    expect(destinationProblem(from, { space: "personal", path: ["p", "d1"] })).toBe("inside");
    expect(destinationProblem(from, { space: "personal", path: ["p", "d1", "deep"] })).toBe("inside");
  });
  it("accepts other folders and the other space", () => {
    expect(destinationProblem(from, { space: "personal", path: [] })).toBeNull();
    expect(destinationProblem(from, { space: "personal", path: ["x"] })).toBeNull();
    expect(destinationProblem(from, { space: "shared", path: ["p"] })).toBeNull();
    expect(destinationProblem(from, { space: "shared", path: [] })).toBeNull();
  });
});

describe("canOpenFolder", () => {
  it("moved folders can't be browsed into (or chosen)", () => {
    expect(canOpenFolder(from, "d1")).toBe(false);
    expect(canOpenFolder(from, "other")).toBe(true);
  });
});

describe("moveBody", () => {
  it("into a folder sends its id; to a root sends null + the space", () => {
    expect(moveBody({ space: "shared", parentId: "x" })).toEqual({ parent_id: "x" });
    expect(moveBody({ space: "shared", parentId: null })).toEqual({ parent_id: null, space: "shared" });
    expect(moveBody({ space: "personal", parentId: null })).toEqual({ parent_id: null, space: "personal" });
  });
});

describe("labels", () => {
  it("names spaces and the other space", () => {
    expect(otherSpace("personal")).toBe("shared");
    expect(otherSpace("shared")).toBe("personal");
    expect(spaceLabel("personal")).toBe(en["nav.myFiles"]);
    expect(spaceLabel("shared")).toBe(en["nav.shared"]);
  });
  it("summarizes a move with or without a destination", () => {
    expect(moveDoneMessage(["f1"], from.names)).toBe("Moved “a.txt”");
    expect(moveDoneMessage(["f1", "d1"], from.names)).toBe("Moved 2 items");
    expect(moveDoneMessage(["f1"], from.names, "Shared space")).toBe("Moved “a.txt” to Shared space");
    expect(moveDoneMessage(["f1", "d1", "x"], from.names, "Shared space")).toBe("Moved 3 items to Shared space");
  });
});

describe("move error messages", () => {
  it("are plain language", async () => {
    const { moveErrorKey } = await import("../moveDrag");
    expect(en[moveErrorKey(new ApiError(409, "name_taken"))]).toBe("An item with that name already exists in the destination");
    expect(en[moveErrorKey(new ApiError(507, "quota_exceeded"))]).toBe("Not enough storage space to move this to My files");
  });
});
