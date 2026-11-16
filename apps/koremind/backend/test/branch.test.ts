import { expect, test } from "bun:test";
import { branchTo, newestLeafUnder, transcriptOf, variantsOf, type Node } from "../src/branch";

// u1 → a1 → u2 → a2, and u2 edited into u2b → a2b
const n = (id: string, parentId: string | null, role: string, createdAt: number, text = id): Node => ({ id, parentId, role, text, createdAt });
const all = [n("u1", null, "user", 1), n("a1", "u1", "assistant", 2), n("u2", "a1", "user", 3), n("a2", "u2", "assistant", 4), n("u2b", "a1", "user", 5), n("a2b", "u2b", "assistant", 6)];
const byId = new Map(all.map((m) => [m.id, m]));

test("a branch is the path from the first message to the leaf", () => {
  expect(branchTo("a2", byId).map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"]);
  expect(branchTo("a2b", byId).map((m) => m.id)).toEqual(["u1", "a1", "u2b", "a2b"]);
  expect(branchTo(null, byId)).toEqual([]);
});

test("a loop or a missing parent ends the branch instead of hanging", () => {
  const loop = new Map([["x", n("x", "y", "user", 1)], ["y", n("y", "x", "assistant", 2)]]);
  expect(branchTo("x", loop).length).toBe(2);
  expect(branchTo("u2", new Map([["u2", n("u2", "gone", "user", 1)]])).map((m) => m.id)).toEqual(["u2"]);
});

test("switching to a variant continues to its newest message", () => {
  expect(newestLeafUnder("u2", all)).toBe("a2");
  expect(newestLeafUnder("u2b", all)).toBe("a2b");
  expect(newestLeafUnder("u1", all)).toBe("a2b");
});

test("variants are the user messages with the same parent, oldest first", () => {
  expect(variantsOf(byId.get("u2b")!, all)).toEqual(["u2", "u2b"]);
  expect(variantsOf(byId.get("u1")!, all)).toEqual(["u1"]);
});

test("the transcript labels speakers, skips empty messages and keeps the newest when long", () => {
  expect(transcriptOf([])).toBe("");
  const t = transcriptOf([{ role: "user", text: "Hi" }, { role: "assistant", text: "" }, { role: "assistant", text: "Hello" }]);
  expect(t).toContain("User: Hi\n\nAssistant: Hello");
  const long = transcriptOf(Array.from({ length: 20 }, (_, i) => ({ role: "user", text: `${i} ` + "x".repeat(5000) })));
  expect(long).toContain("19 x");
  expect(long).not.toContain("0 x");
  expect(long.length).toBeLessThan(30_000);
});
