import { expect, test } from "bun:test";
import { openDb } from "../src/db";
import { createModels } from "../src/models";
import { FakeEngine } from "../src/engine/fake";

import { createSettings } from "../src/settings";

/** u1 is the owner, u2 is another account. */
const setup = (engine = new FakeEngine()) => {
  const db = openDb(":memory:");
  for (const [u, owner] of [["u1", 1], ["u2", 0]] as const) db.run("insert into users(id,email,password_hash,is_owner,created_at) values(?,?,?,?,1)", [u, `${u}@x.co`, "", owner]);
  const settings = createSettings(db);
  return { models: createModels(db, engine, (u) => settings.get(u), (u) => u === "u1"), engine, settings };
};
const base = { memoryEnabled: true, displayName: "", tone: "", about: "" };

test("providers come from the engine and exactly one default model exists", async () => {
  const { models } = setup();
  const ps = await models.providers("u1");
  expect(ps.find((p) => p.id === "opencode")!.models.filter((m) => m.isDefault)).toHaveLength(1);
});

test("favorites persist per user", async () => {
  const { models } = setup();
  await models.setFavorites("u1", ["opencode/fast"]);
  expect(models.favorites("u1")).toEqual(["opencode/fast"]);
  expect(models.favorites("u2")).toEqual([]);
});

test("invalid favorite keys are dropped", async () => {
  const { models } = setup();
  await models.setFavorites("u1", ["opencode/fast", "nope/none", "garbage"]);
  expect(models.favorites("u1")).toEqual(["opencode/fast"]);
});

test("providers come in engine order: claude, opencode, opencode-go", async () => {
  const { models } = setup();
  const ps = await models.providers("u1");
  expect(ps.map((p) => p.id)).toEqual(["claude", "opencode", "opencode-go"]);
});

test("every offered provider is listed with a status; only ready ones carry models", async () => {
  const { models, engine } = setup();
  const ps = await models.providers("u1");
  expect(ps.map((p) => [p.id, p.status, p.models.length > 0])).toEqual([["claude", "needs_connection", false], ["opencode", "ready", true], ["opencode-go", "needs_connection", false]]);
  engine.connected.add("claude");
  const c = (await models.providers("u1")).find((p) => p.id === "claude")!;
  expect(c).toMatchObject({ status: "ready", connected: true });
  expect(c.models.filter((m) => m.isDefault).map((m) => m.id)).toEqual(["claude-sonnet-5-5"]);
});

test("Claude is the owner's only: others see it disabled and can't use it", async () => {
  const { models, engine } = setup();
  engine.connected.add("claude");
  expect((await models.providers("u1")).find((p) => p.id === "claude")).toMatchObject({ status: "ready" });
  expect(await models.allowed("u1", "claude", "claude-sonnet-5-5")).toBe(true);
  const theirs = (await models.providers("u2")).find((p) => p.id === "claude")!;
  expect(theirs.status).toBe("disabled");
  expect(theirs.models).toEqual([]);
  expect(await models.allowed("u2", "claude", "claude-sonnet-5-5")).toBe(false);
  await models.setFavorites("u2", ["claude/claude-sonnet-5-5"]);
  expect(models.favorites("u2")).toEqual([]);
});

test("a provider the user turned off is disabled and empty for that user only", async () => {
  const { models, settings, engine } = setup();
  engine.connected.add("opencode-go");
  settings.put("u1", { ...base, disabledProviders: ["opencode-go"], freeOnlyProviders: [] });
  const mine = (await models.providers("u1")).find((p) => p.id === "opencode-go")!;
  expect(mine.status).toBe("disabled");
  expect(mine.models).toEqual([]);
  expect((await models.providers("u2")).find((p) => p.id === "opencode-go")!.status).toBe("ready");
});

test("free-only keeps just free models and still leaves exactly one default", async () => {
  const { models, settings } = setup();
  settings.put("u1", { ...base, disabledProviders: [], freeOnlyProviders: ["opencode"] });
  const oc = (await models.providers("u1")).find((p) => p.id === "opencode")!;
  expect(oc.models.map((m) => m.id)).toEqual(["fast"]);
  expect(oc.models.filter((m) => m.isDefault)).toHaveLength(1);
});

test("allowed() refuses paid, disabled and unconnected choices, and favorites follow it", async () => {
  const { models, settings, engine } = setup();
  expect(await models.allowed("u1", "opencode-go", "deepseek-pro")).toBe(false); // not connected
  engine.connected.add("opencode-go");
  expect(await models.allowed("u1", "opencode-go", "deepseek-pro")).toBe(true);
  expect(await models.allowed("u1", "opencode", "vision")).toBe(true);
  settings.put("u1", { ...base, disabledProviders: [], freeOnlyProviders: ["opencode"] });
  expect(await models.allowed("u1", "opencode", "vision")).toBe(false); // paid while free-only
  expect(await models.allowed("u1", "opencode", "fast")).toBe(true);
  settings.put("u1", { ...base, disabledProviders: ["opencode-go"], freeOnlyProviders: [] });
  expect(await models.allowed("u1", "opencode-go", "deepseek-pro")).toBe(false);
  await models.setFavorites("u1", ["opencode-go/deepseek-pro", "opencode/fast"]);
  expect(models.favorites("u1")).toEqual(["opencode/fast"]);
});

test("OpenCode Go has no models until it is signed in on the server, then its models are usable and not free-filtered", async () => {
  const { models, engine } = setup();
  expect((await models.providers("u1")).find((p) => p.id === "opencode-go")).toMatchObject({ status: "needs_connection", models: [] });
  expect(await models.allowed("u1", "opencode-go", "deepseek-pro")).toBe(false);
  engine.connected.add("opencode-go");
  const go = (await models.providers("u1")).find((p) => p.id === "opencode-go")!;
  expect(go).toMatchObject({ status: "ready", connected: true });
  expect(go.models.map((m) => m.free)).toEqual([false, false]);
  expect(go.models.filter((m) => m.isDefault)).toHaveLength(1);
  expect(await models.allowed("u1", "opencode-go", "deepseek-pro")).toBe(true);
});
