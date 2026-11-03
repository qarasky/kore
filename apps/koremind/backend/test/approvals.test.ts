import { expect, test } from "bun:test";
import type { StreamEvent } from "@koremind/shared";
import { createApprovals } from "../src/approvals";

const setup = (timeoutMs = 1000) => {
  const events: { chatId: string; ev: StreamEvent }[] = [];
  const approvals = createApprovals({ emit: (chatId, ev) => { events.push({ chatId, ev }); }, timeoutMs });
  return { approvals, events };
};
const ask = (a: ReturnType<typeof createApprovals>, over: Partial<Parameters<ReturnType<typeof createApprovals>["ask"]>[0]> = {}) =>
  a.ask({ userId: "u1", chatId: "c1", targetChatId: "c2", chatTitle: "Trip", action: "read", ...over });
const pendingId = (events: { ev: StreamEvent }[]) => (events.find((e) => e.ev.type === "approval")!.ev as Extract<StreamEvent, { type: "approval" }>).id;

test("asking emits an approval event; allowing resolves it and closes the card", async () => {
  const { approvals, events } = setup();
  const p = ask(approvals);
  expect(events[0]).toMatchObject({ chatId: "c1", ev: { type: "approval", action: "read", chat: "Trip" } });
  expect(approvals.answer("u1", "c1", pendingId(events), true)).toBe(true);
  expect(await p).toBe("allowed");
  expect(events.at(-1)!.ev).toEqual({ type: "approval_closed", id: pendingId(events), outcome: "allowed" });
});

test("denying resolves denied", async () => {
  const { approvals, events } = setup();
  const p = ask(approvals);
  approvals.answer("u1", "c1", pendingId(events), false);
  expect(await p).toBe("denied");
  expect(events.at(-1)!.ev).toMatchObject({ type: "approval_closed", outcome: "denied" });
});

test("no answer in time expires the request", async () => {
  const { approvals, events } = setup(15);
  expect(await ask(approvals)).toBe("expired");
  expect(events.at(-1)!.ev).toMatchObject({ type: "approval_closed", outcome: "expired" });
});

test("an allowed chat stays allowed for the rest of the turn; edit covers read but not the reverse", async () => {
  const { approvals, events } = setup();
  const first = ask(approvals, { action: "edit" });
  approvals.answer("u1", "c1", pendingId(events), true);
  await first;
  const before = events.length;
  expect(await ask(approvals, { action: "read" })).toBe("allowed");
  expect(await ask(approvals, { action: "edit" })).toBe("allowed");
  expect(events.length).toBe(before); // no new card

  const other = setup();
  const r = ask(other.approvals, { action: "read" });
  other.approvals.answer("u1", "c1", pendingId(other.events), true);
  await r;
  const e = ask(other.approvals, { action: "edit" }); // a read grant does not cover edit
  expect(other.events.filter((x) => x.ev.type === "approval")).toHaveLength(2);
  other.approvals.endTurn("c1");
  expect(await e).toBe("expired");
});

test("grants end with the turn", async () => {
  const { approvals, events } = setup();
  const p = ask(approvals);
  approvals.answer("u1", "c1", pendingId(events), true);
  await p;
  approvals.endTurn("c1");
  const again = ask(approvals);
  expect(events.filter((x) => x.ev.type === "approval")).toHaveLength(2);
  approvals.endTurn("c1");
  await again;
});

test("only the owner of the chat can answer, and an answered request can't be answered twice", async () => {
  const { approvals, events } = setup();
  const p = ask(approvals);
  const id = pendingId(events);
  expect(approvals.answer("u2", "c1", id, true)).toBe(false);
  expect(approvals.answer("u1", "other-chat", id, true)).toBe(false);
  expect(approvals.answer("u1", "c1", "nope", true)).toBe(false);
  expect(approvals.answer("u1", "c1", id, false)).toBe(true);
  expect(approvals.answer("u1", "c1", id, true)).toBe(false);
  expect(await p).toBe("denied");
});
