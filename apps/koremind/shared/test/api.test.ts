import { expect, test } from "bun:test";
import { Health, ProviderConnection, SendMessageRequest, StreamEvent } from "../src/index";

test("Health has no password-login switch and defaults sso to off", () => {
  const h = Health.parse({ name: "koremind", version: "1", setupRequired: false });
  expect(h).toEqual({ name: "koremind", version: "1", setupRequired: false, sso: false });
  expect("passwordLogin" in h).toBe(false);
});

test("StreamEvent parses a delta", () => {
  const ev = StreamEvent.parse({ type: "delta", text: "hi" });
  expect(ev).toEqual({ type: "delta", text: "hi" });
});

test("StreamEvent parses a no_provider error", () => {
  const ev = StreamEvent.parse({ type: "error", code: "no_provider", message: "Connect a provider" });
  expect(ev.type === "error" && ev.code).toBe("no_provider");
});

test("SendMessageRequest requires model", () => {
  expect(SendMessageRequest.safeParse({ text: "hi", attachmentIds: [] }).success).toBe(false);
  expect(
    SendMessageRequest.safeParse({ text: "hi", attachmentIds: [], model: { providerId: "opencode", modelId: "big-pickle" } }).success,
  ).toBe(true);
});

test("a provider connection is status only, with a server hint", () => {
  const c = ProviderConnection.parse({ id: "claude", name: "Claude", connected: false, supportsFreeFilter: false, hint: "Run `claude auth login` on the server." });
  expect(c).toEqual({ id: "claude", name: "Claude", connected: false, supportsFreeFilter: false, hint: "Run `claude auth login` on the server." });
  expect(ProviderConnection.parse({ id: "x", name: "X", connected: true, supportsFreeFilter: false }).hint).toBe("");
  expect(Object.keys(ProviderConnection.parse({ id: "x", name: "X", connected: true, supportsFreeFilter: false, methods: ["key"], recommended: true }))).not.toContain("methods");
});
