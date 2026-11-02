import { expect, test } from "bun:test";
import type { StreamEvent } from "@zero/shared";
import { applyEvent, beginTurn, emptyChat } from "../lib/chat-state";

const run = (events: StreamEvent[], text = "hi") => events.reduce(applyEvent, beginTurn(emptyChat, text, []));

test("send shows the user message and thinking indicator before the first event", () => {
  const s = beginTurn(emptyChat, "hello", []);
  expect(s.messages[0]).toMatchObject({ role: "user", text: "hello" });
  expect(s.draft).toMatchObject({ status: "thinking", text: "" });
});

test("applyEvent appends deltas in order and clears the thinking status", () => {
  const s = run([{ type: "delta", text: "Hel" }, { type: "delta", text: "lo" }]);
  expect(s.draft).toMatchObject({ text: "Hello", status: null });
});

test("applyEvent shows searching status then sources", () => {
  const s = run([{ type: "status", state: "searching" }]);
  expect(s.draft?.status).toBe("searching");
  const s2 = [{ type: "source", title: "Bun", url: "https://bun.sh" }, { type: "delta", text: "ok" }].reduce(applyEvent, s as any) as ReturnType<typeof applyEvent>;
  expect(s2.draft?.sources).toEqual([{ title: "Bun", url: "https://bun.sh" }]);
});

test("done moves the draft into an assistant message", () => {
  const s = run([{ type: "delta", text: "Hi!" }, { type: "done", messageId: "m9" }]);
  expect(s.draft).toBeNull();
  expect(s.messages.map((m) => [m.role, m.text])).toEqual([["user", "hi"], ["assistant", "Hi!"]]);
  expect(s.messages[1].id).toBe("m9");
});

test("error no_provider sets connectProvider and keeps partial text", () => {
  const s = run([{ type: "delta", text: "part" }, { type: "error", code: "no_provider", message: "Connect" }]);
  expect(s.connectProvider).toBe(true);
  expect(s.error).toEqual({ code: "no_provider", message: "Connect" });
  expect(s.messages[s.messages.length - 1]).toMatchObject({ role: "assistant", text: "part" });
});

test("error with no partial text leaves no empty assistant bubble", () => {
  const s = run([{ type: "error", code: "engine", message: "boom" }]);
  expect(s.messages.map((m) => m.role)).toEqual(["user"]);
  expect(s.draft).toBeNull();
});

test("beginTurn clears a previous error", () => {
  const s = beginTurn(run([{ type: "error", code: "engine", message: "boom" }]), "again", []);
  expect(s.error).toBeNull();
  expect(s.connectProvider).toBe(false);
});
