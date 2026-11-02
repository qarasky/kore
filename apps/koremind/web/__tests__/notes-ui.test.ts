import { expect, test } from "bun:test";
import type { StreamEvent } from "@zero/shared";
import { activityText, approvalText } from "../lib/notes-ui";
import { applyEvent, beginTurn, emptyChat } from "../lib/chat-state";

const run = (events: StreamEvent[]) => events.reduce(applyEvent, beginTurn(emptyChat, "hi", []));

test("activity chips read the same on every platform", () => {
  expect(activityText({ kind: "saved", title: "Milk" })).toBe("Saved note “Milk”");
  expect(activityText({ kind: "edited", title: "Milk" })).toBe("Updated note “Milk”");
  expect(activityText({ kind: "read", title: "notes" })).toBe("Read notes");
  expect(activityText({ kind: "read", title: "notes", chat: "Lisbon trip" })).toBe("Read notes from “Lisbon trip”");
  expect(activityText({ kind: "denied", title: "notes", chat: "Lisbon trip" })).toBe("Access to “Lisbon trip” was denied");
});

test("the approval card asks in plain words", () => {
  expect(approvalText({ id: "a", action: "read", chat: "Lisbon trip" })).toBe("Zero wants to read the notes from “Lisbon trip”");
  expect(approvalText({ id: "a", action: "edit", chat: "Lisbon trip" })).toBe("Zero wants to edit the notes in “Lisbon trip”");
});

test("an approval card appears, closes when answered, and activity lands on the finished message", () => {
  let s = run([{ type: "status", state: "thinking" }, { type: "approval", id: "a1", action: "read", chat: "Lisbon trip" }]);
  expect(s.draft!.approvals).toEqual([{ id: "a1", action: "read", chat: "Lisbon trip" }]);
  s = applyEvent(s, { type: "approval_closed", id: "a1", outcome: "allowed" });
  expect(s.draft!.approvals).toEqual([]);
  s = applyEvent(s, { type: "activity", kind: "read", title: "notes", chat: "Lisbon trip" });
  expect(s.draft!.activity).toEqual([{ kind: "read", title: "notes", chat: "Lisbon trip" }]);
  s = applyEvent(s, { type: "delta", text: "ok" });
  s = applyEvent(s, { type: "done", messageId: "m1" });
  expect(s.draft).toBeNull();
  expect(s.messages.at(-1)!.activity).toEqual([{ kind: "read", title: "notes", chat: "Lisbon trip" }]);
});

test("an expired request shows a note until the reply ends", () => {
  let s = run([{ type: "approval", id: "a1", action: "edit", chat: "Trip" }, { type: "approval_closed", id: "a1", outcome: "expired" }]);
  expect(s.draft!.approvals).toEqual([]);
  expect(s.draft!.expired).toBe(true);
  s = applyEvent(applyEvent(s, { type: "delta", text: "x" }), { type: "done", messageId: "m" });
  expect(s.draft).toBeNull();
});

test("a stream error keeps activity-only replies", () => {
  const s = run([{ type: "activity", kind: "saved", title: "Milk" }, { type: "error", code: "engine", message: "boom" }]);
  expect(s.messages.at(-1)!.activity).toEqual([{ kind: "saved", title: "Milk" }]);
  expect(s.draft).toBeNull();
});

import { secondsLeft } from "../lib/pair-timer";
test("the pairing countdown rounds up and stops at zero", () => {
  expect(secondsLeft(120_000, 0)).toBe(120);
  expect(secondsLeft(120_000, 119_001)).toBe(1);
  expect(secondsLeft(120_000, 125_000)).toBe(0);
});
