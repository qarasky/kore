import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { androidProps, androidVersionCode, meta, parseSemver, setVersion, verifyVersion } from "./version";

test("parses plain and pre-release versions and rejects everything else", () => {
  expect(parseSemver("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, pre: null });
  expect(parseSemver("0.4.0-rc.2").pre).toEqual({ label: "rc", n: 2 });
  for (const bad of ["1.2", "1.2.3.4", "1.2.3-alpha.1", "1.2.3-rc", "1.2.3+build", "latest", "1.100.0", "1.0.100"]) expect(() => parseSemver(bad)).toThrow();
});

test("the Android versionCode only grows: beta < rc < release < next patch < next minor < next major", () => {
  const order = ["0.1.0-beta.1", "0.1.0-beta.2", "0.1.0-rc.1", "0.1.0-rc.2", "0.1.0", "0.1.1-rc.1", "0.1.1", "0.2.0", "1.0.0"];
  const codes = order.map(androidVersionCode);
  expect(codes).toEqual([...codes].sort((a, b) => a - b));
  expect(new Set(codes).size).toBe(codes.length);
  expect(androidVersionCode("0.1.0")).toBe(10099);
  expect(androidVersionCode("2.10.3")).toBe(2_100_399);
  expect(() => androidVersionCode("1.0.0-rc.49")).toThrow();
});

test("set writes every file and verify then agrees; a stale file is reported", () => {
  const root = mkdtempSync(join(tmpdir(), "koremind-ver-"));
  for (const d of ["backend", "shared", "web", "android"]) mkdirSync(join(root, d));
  const repo = join(import.meta.dir, "..");
  for (const f of ["package.json", "backend/package.json", "shared/package.json", "web/package.json"]) cpSync(join(repo, f), join(root, f));
  setVersion(root, "0.3.0-rc.1");
  expect(verifyVersion(root, "v0.3.0-rc.1")).toEqual([]);
  expect(readFileSync(join(root, "android/version.properties"), "utf8")).toBe(androidProps("0.3.0-rc.1"));
  expect(meta(root)).toEqual({ version: "0.3.0-rc.1", prerelease: "true", android_version_code: "30051" });
  expect(verifyVersion(root, "v0.3.0")[0]).toContain("expected 0.3.0");
  expect(verifyVersion(root, "nonsense")[0]).toContain("not a version");
});

test("the committed files agree with each other", () => {
  const repo = join(import.meta.dir, "..");
  const v = meta(repo).version;
  expect(verifyVersion(repo, v)).toEqual([]);
});
