import { expect, test } from "bun:test";
import { openDb } from "../src/db";
import { createModels } from "../src/models";
import { FakeEngine } from "../src/engine/fake";

const setup = (engine = new FakeEngine()) => {
  const db = openDb(":memory:");
  for (const u of ["u1", "u2"]) db.run("insert into users(id,email,password_hash,is_owner,created_at) values(?,?,?,0,1)", [u, `${u}@x.co`, "h"]);
  return { models: createModels(db, engine), engine };
};

test("providers come from the engine and exactly one default model exists", async () => {
  const { models } = setup();
  const ps = await models.providers();
  expect(ps[0].models.filter((m) => m.isDefault)).toHaveLength(1);
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
