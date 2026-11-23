import { expect, test } from "bun:test";
import type { Attachment } from "@koremind/shared";
import { addUploading, markFailed, markReady, readyAttachments, removePending, retrying, uploadNotice, uploadingCount, type PendingFile } from "../lib/pending-files";

const file = (key: string): Omit<PendingFile, "state"> => ({ key, name: `${key}.png`, mime: "image/png", size: 10 });
const att = (id: string): Attachment => ({ id, name: `${id}.png`, mime: "image/png", size: 10 });
const three = () => ["A", "B", "C"].reduce<PendingFile[]>((list, k) => addUploading(list, file(k)), []);

test("files finishing out of order keep the pick order, each updated in place", () => {
  let list = three();
  list = markReady(list, "B", att("b"));
  list = markReady(list, "C", att("c"));
  list = markReady(list, "A", att("a"));
  expect(list.map((f) => f.key)).toEqual(["A", "B", "C"]);
  expect(list.map((f) => f.state)).toEqual(["ready", "ready", "ready"]);
  expect(readyAttachments(list).map((a) => a.id)).toEqual(["a", "b", "c"]);
});

test("only uploading files count as uploading and only ready ones are sent", () => {
  let list = three();
  list = markReady(list, "A", att("a"));
  list = markFailed(list, "B", "offline");
  expect(uploadingCount(list)).toBe(1);
  expect(readyAttachments(list).map((a) => a.id)).toEqual(["a"]);
});

test("a failed file keeps its error and goes back to uploading on retry with the error cleared", () => {
  let list = markFailed(three(), "B", "offline");
  expect(list[1]).toMatchObject({ state: "failed", error: "offline" });
  list = retrying(list, "B");
  expect(list[1].state).toBe("uploading");
  expect(list[1].error).toBeUndefined();
});

test("an upload that ends after its file was removed changes nothing", () => {
  const list = removePending(three(), "B");
  expect(list.map((f) => f.key)).toEqual(["A", "C"]);
  expect(markReady(list, "B", att("b"))).toEqual(list);
  expect(markFailed(list, "B", "x")).toEqual(list);
  expect(retrying(list, "B")).toEqual(list);
  expect(removePending(list, "B")).toEqual(list);
});

test("uploadNotice names the latest failure, falls back to the generic text, and is null when nothing failed", () => {
  expect(uploadNotice(three(), "Upload failed")).toBeNull();
  let list = markFailed(three(), "A", "That file type isn't supported.");
  list = markFailed(list, "B", "offline");
  expect(uploadNotice(list, "Upload failed")).toBe("offline");
  expect(uploadNotice(markFailed(three(), "C", ""), "Upload failed")).toBe("Upload failed");
  expect(uploadNotice(removePending(markFailed(three(), "C", "x"), "C"), "Upload failed")).toBeNull();
});
