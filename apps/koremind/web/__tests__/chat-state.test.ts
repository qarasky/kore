import { expect, test } from "bun:test";
import type { StreamEvent } from "@koremind/shared";
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

import { needsLoad } from "../lib/chat-state";

test("needsLoad ignores the URL catching up to a chat we just created", () => {
  expect(needsLoad("abc", "abc")).toBe(false); // created here, URL now matches
  expect(needsLoad(null, null)).toBe(false);
  expect(needsLoad("abc", null)).toBe(true); // opened from the sidebar
  expect(needsLoad(null, "abc")).toBe(true); // New chat clicked
  expect(needsLoad("def", "abc")).toBe(true);
});

import { canSend } from "../lib/chat-state";
import { uploadSizeError } from "../lib/upload";
import { lacksVision } from "../lib/model-picker";

test("canSend refuses without a model, while busy, while uploading, or when empty", () => {
  const ok = { text: "hi", fileCount: 0, uploading: 0, busy: false, hasModel: true };
  expect(canSend(ok)).toBe(true);
  expect(canSend({ ...ok, hasModel: false })).toBe(false);
  expect(canSend({ ...ok, busy: true })).toBe(false);
  expect(canSend({ ...ok, uploading: 1 })).toBe(false);
  expect(canSend({ ...ok, text: "  " })).toBe(false);
  expect(canSend({ ...ok, text: "", fileCount: 1 })).toBe(true);
});

test("uploadSizeError uses the server's wording and passes small files", () => {
  expect(uploadSizeError(21 * 1024 * 1024)).toBe("That file is too large. The limit is 20 MB.");
  expect(uploadSizeError(1024)).toBeNull();
});

test("lacksVision warns only for images on a text-only model", () => {
  const img = [{ id: "a", name: "p.png", mime: "image/png", size: 1 }];
  const pdf = [{ id: "b", name: "d.pdf", mime: "application/pdf", size: 1 }];
  const textOnly = { id: "m", name: "M", vision: false, thinkingLevels: [], isDefault: true };
  expect(lacksVision(img, textOnly)).toBe(true);
  expect(lacksVision(img, { ...textOnly, vision: true })).toBe(false);
  expect(lacksVision(pdf, textOnly)).toBe(false);
  expect(lacksVision(img, undefined)).toBe(false);
});

test("a title event after done changes nothing in the transcript", () => {
  let s = beginTurn(emptyChat, "hi", []);
  s = applyEvent(s, { type: "delta", text: "yo" });
  s = applyEvent(s, { type: "done", messageId: "m1" });
  const after = applyEvent(s, { type: "title", title: "Greeting" });
  expect(after).toEqual(s);
});

test("a source the engine repeats is kept once", () => {
  const evs: StreamEvent[] = [
    { type: "source", title: "Runpod pricing", url: "https://runpod.io/pricing" },
    { type: "source", title: "Runpod pricing", url: "https://www.runpod.io/pricing/?utm_source=x" },
    { type: "source", title: "Gemini pricing", url: "https://ai.google.dev/pricing" },
  ];
  const s = evs.reduce(applyEvent, beginTurn(emptyChat, "q", []));
  expect(s.draft!.sources.map((x) => x.url)).toEqual(["https://runpod.io/pricing", "https://ai.google.dev/pricing"]);
});

import { beginEdit, reconnecting, restartDraft, variantAt, variantPosition, withServerMessages } from "../lib/chat-state";
import type { ChatMessage } from "@koremind/shared";

const msg = (id: string, role: "user" | "assistant", text: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role, text, attachments: [], sources: [], activity: [], createdAt: 1, ...extra });

test("editing drops the message and everything after it, keeps its files and starts a new answer", () => {
  const file = { id: "f", name: "a.png", mime: "image/png", size: 1 };
  const s = { ...emptyChat, messages: [msg("u1", "user", "a"), msg("a1", "assistant", "A"), msg("u2", "user", "b", { attachments: [file] }), msg("a2", "assistant", "B")] };
  const e = beginEdit(s, "u2", "b2");
  expect(e.messages.map((m) => m.text)).toEqual(["a", "A", "b2"]);
  expect(e.messages[2].attachments).toEqual([file]);
  expect(e.draft?.status).toBe("thinking");
  expect(beginEdit(s, "a1", "x")).toBe(s); // only user messages
  expect(beginEdit(s, "nope", "x")).toBe(s);
});

test("a dropped connection keeps the partial answer and shows reconnecting; a replay starts it over", () => {
  let s = beginTurn(emptyChat, "q", []);
  s = applyEvent(s, { type: "delta", text: "par" });
  s = applyEvent(s, { type: "error", code: "network", message: "The connection dropped." });
  expect(s.draft).toMatchObject({ text: "par", status: "reconnecting" });
  expect(s.error).toBeNull();
  expect(s.messages).toHaveLength(1);
  expect(reconnecting(emptyChat).draft?.status).toBe("reconnecting");
  expect(restartDraft(s).draft).toMatchObject({ text: "", status: "thinking" });
});

test("the server's messages replace the local ones and end the draft", () => {
  const s = withServerMessages(beginTurn(emptyChat, "q", []), [msg("u1", "user", "q"), msg("a1", "assistant", "A")]);
  expect(s.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
  expect(s.draft).toBeNull();
});

test("variants read as 2 / 3 and step to their neighbours", () => {
  const m = msg("b", "user", "x", { siblings: ["a", "b", "c"] });
  expect(variantPosition(m)).toEqual({ index: 2, count: 3 });
  expect(variantAt(m, -1)).toBe("a");
  expect(variantAt(m, 1)).toBe("c");
  expect(variantAt(msg("c", "user", "x", { siblings: ["a", "b", "c"] }), 1)).toBeNull();
  expect(variantPosition(msg("a", "user", "x"))).toBeNull();
  expect(variantAt(msg("a", "user", "x"), 1)).toBeNull();
});

test("canSend waits for uploads but is not blocked by a file that failed", () => {
  const base = { text: "hi", fileCount: 0, busy: false, hasModel: true };
  expect(canSend({ ...base, uploading: 0 })).toBe(true); // the only file failed: it is left out
  expect(canSend({ ...base, uploading: 1 })).toBe(false);
  expect(canSend({ ...base, text: "", fileCount: 1, uploading: 0 })).toBe(true);
});
