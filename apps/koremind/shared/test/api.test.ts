import { expect, test } from "bun:test";
import { AuthRequest, SendMessageRequest, StreamEvent } from "../src/index";

test("AuthRequest rejects short password", () => {
  expect(AuthRequest.safeParse({ email: "a@b.co", password: "short" }).success).toBe(false);
  expect(AuthRequest.safeParse({ email: "a@b.co", password: "longenough" }).success).toBe(true);
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
