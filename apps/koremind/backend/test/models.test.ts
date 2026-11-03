import { expect, test } from "bun:test";
import { openDb } from "../src/db";
import { createModels } from "../src/models";
import { FakeEngine } from "../src/engine/fake";

import { createSettings } from "../src/settings";

const setup = (engine = new FakeEngine()) => {
  const db = openDb(":memory:");
  for (const u of ["u1", "u2"]) db.run("insert into users(id,email,password_hash,is_owner,created_at) values(?,?,?,0,1)", [u, `${u}@x.co`, "h"]);
  const settings = createSettings(db);
  return { models: createModels(db, engine, (u) => settings.get(u)), engine, settings };
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

test("connect and disconnect forward to the engine", async () => {
  const { models, engine } = setup();
  await models.connect("opencode", "sk-123");
  expect(engine.keys.get("opencode")).toBe("sk-123");
  await models.disconnect("opencode");
  expect(engine.keys.has("opencode")).toBe(false);
});

test("every offered provider is listed with a status; only ready ones carry models", async () => {
  const { models } = setup();
  const ps = await models.providers("u1");
  expect(ps.map((p) => [p.id, p.status, p.models.length > 0])).toEqual([["groq", "needs_connection", false], ["openrouter", "needs_connection", false], ["opencode", "ready", true], ["openai", "needs_connection", false]]);
  await models.connect("openrouter", "sk-or");
  const after = await models.providers("u1");
  expect(after.find((p) => p.id === "openrouter")).toMatchObject({ status: "ready", connected: true });
  expect(after.find((p) => p.id === "openrouter")!.models.map((m) => m.free)).toEqual([true, false]);
});

test("Groq and OpenRouter are the recommended providers and come first", async () => {
  const { models } = setup();
  const ps = await models.providers("u1");
  expect(ps.map((p) => [p.id, p.recommended])).toEqual([["groq", true], ["openrouter", true], ["opencode", false], ["openai", false]]);
  await models.connect("groq", "gsk-test");
  const g = (await models.providers("u1")).find((p) => p.id === "groq")!;
  expect(g).toMatchObject({ status: "ready", connected: true });
  expect(g.models.filter((m) => m.isDefault)).toHaveLength(1);
  expect(await models.allowed("u1", "groq", "llama-fast")).toBe(true);
});

test("a provider the user turned off is disabled and empty for that user only", async () => {
  const { models, settings } = setup();
  await models.connect("openrouter", "sk-or");
  settings.put("u1", { ...base, disabledProviders: ["openrouter"], freeOnlyProviders: [] });
  const mine = (await models.providers("u1")).find((p) => p.id === "openrouter")!;
  expect(mine.status).toBe("disabled");
  expect(mine.models).toEqual([]);
  expect((await models.providers("u2")).find((p) => p.id === "openrouter")!.status).toBe("ready");
});

test("free-only keeps just free models and still leaves exactly one default", async () => {
  const { models, settings } = setup();
  await models.connect("openrouter", "sk-or");
  settings.put("u1", { ...base, disabledProviders: [], freeOnlyProviders: ["openrouter", "opencode"] });
  const ps = await models.providers("u1");
  const or = ps.find((p) => p.id === "openrouter")!;
  expect(or.models.every((m) => m.free)).toBe(true);
  expect(or.models.filter((m) => m.isDefault)).toHaveLength(1);
  expect(ps.find((p) => p.id === "opencode")!.models.map((m) => m.id)).toEqual(["fast"]);
});

test("allowed() refuses paid, disabled and unconnected choices, and favorites follow it", async () => {
  const { models, settings } = setup();
  expect(await models.allowed("u1", "openrouter", "acme/pro")).toBe(false); // not connected
  await models.connect("openrouter", "sk-or");
  expect(await models.allowed("u1", "openrouter", "acme/pro")).toBe(true);
  settings.put("u1", { ...base, disabledProviders: [], freeOnlyProviders: ["openrouter"] });
  expect(await models.allowed("u1", "openrouter", "acme/pro")).toBe(false); // paid while free-only
  expect(await models.allowed("u1", "openrouter", "acme/free-model:free")).toBe(true);
  settings.put("u1", { ...base, disabledProviders: ["openrouter"], freeOnlyProviders: [] });
  expect(await models.allowed("u1", "openrouter", "acme/free-model:free")).toBe(false);
  await models.setFavorites("u1", ["openrouter/acme/free-model:free", "opencode/fast"]);
  expect(models.favorites("u1")).toEqual(["opencode/fast"]);
});
