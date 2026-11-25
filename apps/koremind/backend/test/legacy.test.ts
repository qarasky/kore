import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLegacyDb } from "../src/legacy";

test("a database from the Zero days is renamed once, with its WAL files", () => {
  const dir = mkdtempSync(join(tmpdir(), "koremind-legacy-"));
  for (const s of ["", "-wal", "-shm"]) writeFileSync(join(dir, "zero.sqlite" + s), "x");
  expect(migrateLegacyDb(dir)).toBe(true);
  for (const s of ["", "-wal", "-shm"]) { expect(existsSync(join(dir, "koremind.sqlite" + s))).toBe(true); expect(existsSync(join(dir, "zero.sqlite" + s))).toBe(false); }
  expect(migrateLegacyDb(dir)).toBe(false);
});

test("an existing KoreMind database is never overwritten", () => {
  const dir = mkdtempSync(join(tmpdir(), "koremind-legacy-"));
  writeFileSync(join(dir, "zero.sqlite"), "old");
  writeFileSync(join(dir, "koremind.sqlite"), "new");
  expect(migrateLegacyDb(dir)).toBe(false);
  expect(existsSync(join(dir, "zero.sqlite"))).toBe(true);
});
