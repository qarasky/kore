import { expect, test } from "bun:test";
import { Health, SendMessageRequest, StreamEvent } from "../src/index";

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
