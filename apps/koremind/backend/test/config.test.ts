import { expect, test } from "bun:test";
import { loadConfig } from "../src/config";

test("providers default to claude", () => {
  expect(loadConfig({}).providers).toEqual(["claude"]);
  expect(loadConfig({ KOREMIND_PROVIDERS: "  " }).providers).toEqual(["claude"]);
});

test("providers keep their order, trim, lower-case and dedupe", () => {
  expect(loadConfig({ KOREMIND_PROVIDERS: " Claude ,opencode-go,claude" }).providers).toEqual(["claude", "opencode-go"]);
});

test("an unknown provider stops start-up", () => {
  expect(() => loadConfig({ KOREMIND_PROVIDERS: "claude,groq" })).toThrow(/KOREMIND_PROVIDERS: unknown provider "groq" \(claude, opencode, opencode-go\)/);
});

test("host defaults to all interfaces and can be pinned", () => {
  expect(loadConfig({}).host).toBe("0.0.0.0");
  expect(loadConfig({ KOREMIND_HOST: " 127.0.0.1 " }).host).toBe("127.0.0.1");
});

test("claude bin and config dir", () => {
  expect(loadConfig({}).claude).toEqual({ bin: "claude", configDir: "" });
  expect(loadConfig({ KOREMIND_CLAUDE_BIN: " /home/me/.local/bin/claude ", KOREMIND_CLAUDE_CONFIG_DIR: " /srv/claude " }).claude).toEqual({ bin: "/home/me/.local/bin/claude", configDir: "/srv/claude" });
});
