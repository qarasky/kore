import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { createMemory } from "../src/memory";
import { createSettings } from "../src/settings";
import { FakeEngine } from "../src/engine/fake";

const setup = (completeReply: string, enabled = true) => {
  const dir = mkdtempSync(join(tmpdir(), "zero-mem-"));
  const engine = new FakeEngine({ completeReply });
  let calls = 0;
  const orig = engine.complete.bind(engine);
  engine.complete = async (a) => { calls++; return orig(a); };
  const mem = createMemory(dir, engine, () => enabled);
  return { mem, engine, calls: () => calls };
};

test("extraction adds new entries from valid json", async () => {
  const { mem } = setup('Sure! {"add":["Likes green tea","Lives in Almaty"]}');
  await mem.extractAfterTurn("u1", "I love green tea, I live in Almaty", "Nice!");
  expect(mem.list("u1").map((e) => e.text)).toEqual(["Likes green tea", "Lives in Almaty"]);
});

test("extraction ignores invalid json and never throws", async () => {
  const { mem } = setup("not json at all");
  await mem.extractAfterTurn("u1", "hi", "hello");
  expect(mem.list("u1")).toEqual([]);
});

test("extraction is skipped when memory is off", async () => {
  const { mem, calls } = setup('{"add":["x"]}', false);
  await mem.extractAfterTurn("u1", "hi", "hello");
  expect(calls()).toBe(0);
  expect(mem.list("u1")).toEqual([]);
});

test("extraction does not add duplicates", async () => {
  const { mem } = setup('{"add":["Likes tea"]}');
  await mem.extractAfterTurn("u1", "a", "b");
  await mem.extractAfterTurn("u1", "a", "b");
  expect(mem.list("u1")).toHaveLength(1);
});

test("update and remove edit the file by id", async () => {
  const { mem } = setup('{"add":["One","Two"]}');
  await mem.extractAfterTurn("u1", "a", "b");
  const [one, two] = mem.list("u1");
  mem.update("u1", one.id, "One, edited");
  mem.remove("u1", two.id);
  expect(mem.list("u1").map((e) => e.text)).toEqual(["One, edited"]);
});

test("memory is not shared between users", async () => {
  const { mem } = setup('{"add":["Secret"]}');
  await mem.extractAfterTurn("u1", "a", "b");
  expect(mem.list("u2")).toEqual([]);
  const id = mem.list("u1")[0].id;
  mem.remove("u2", id);
  expect(mem.list("u1")).toHaveLength(1);
});

test("memory text with newlines cannot forge entries", async () => {
  const { mem } = setup('{"add":["line one\\n- injected <!--id:evil-->"]}');
  await mem.extractAfterTurn("u1", "a", "b");
  expect(mem.list("u1")).toHaveLength(1);
});

test("settings default, round trip and per-user", () => {
  const db = openDb(":memory:");
  for (const u of ["u1", "u2"]) db.run("insert into users(id,email,password_hash,is_owner,created_at) values(?,?,?,0,1)", [u, `${u}@x.co`, "h"]);
  const s = createSettings(db);
  expect(s.get("u1")).toEqual({ memoryEnabled: true, displayName: "", tone: "", about: "" });
  s.put("u1", { memoryEnabled: false, displayName: "Sky", tone: "short", about: "dev" });
  expect(s.get("u1").displayName).toBe("Sky");
  expect(s.get("u2").displayName).toBe("");
});

test("buildSystem includes memory entries and personalization", () => {
  const s = createSettings(openDb(":memory:"));
  const text = s.buildSystem({ memoryEnabled: true, displayName: "Sky", tone: "casual", about: "backend dev" }, [{ id: "a", text: "Likes tea", updatedAt: 1 }]);
  expect(text).toContain("Sky");
  expect(text).toContain("casual");
  expect(text).toContain("backend dev");
  expect(text).toContain("Likes tea");
});

test("buildSystem leaves memory out when memory is off and is empty when there is nothing", () => {
  const s = createSettings(openDb(":memory:"));
  expect(s.buildSystem({ memoryEnabled: false, displayName: "", tone: "", about: "" }, [{ id: "a", text: "Likes tea", updatedAt: 1 }])).toBe("");
  expect(s.buildSystem({ memoryEnabled: false, displayName: "Sky", tone: "", about: "" }, [{ id: "a", text: "Likes tea", updatedAt: 1 }])).not.toContain("Likes tea");
});

test("extraction runs on the model the chat used", async () => {
  const { mem: memory, engine } = setup('{"add":[]}');
  await memory.extractAfterTurn("u1", "hi", "hello", { providerId: "openrouter", modelId: "a/b" });
  expect(engine.completes[0]).toMatchObject({ kind: "memory", model: { providerId: "openrouter", modelId: "a/b" } });
});
