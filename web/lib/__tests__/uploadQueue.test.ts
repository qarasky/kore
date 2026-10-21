import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import type { UploadOptions } from "../upload";
import { UploadQueue } from "../uploadQueue";

type Pending = { name: string; opts: UploadOptions; resolve: () => void; reject: (e: unknown) => void };

function controlledUploader() {
  const pending: Pending[] = [];
  const upload = vi.fn(
    (file: File, _t: unknown, opts: UploadOptions) =>
      new Promise<{ nodeId: string }>((ok, fail) => {
        const p: Pending = { name: file.name, opts, resolve: () => ok({ nodeId: `n-${file.name}` }), reject: fail };
        opts.signal?.addEventListener("abort", () => fail(new DOMException("x", "AbortError")));
        pending.push(p);
      }),
  );
  return { upload, pending };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const target = { space: "personal" as const, parent: null };
const files = (...names: string[]) => names.map((n) => ({ file: new File(["abc"], n), target }));

describe("UploadQueue", () => {
  it("runs 3 files at a time and drains once", async () => {
    const { upload, pending } = controlledUploader();
    const onDrain = vi.fn();
    const q = new UploadQueue({ upload, onDrain });
    q.add(files("a", "b", "c", "d"));
    await tick();
    expect(upload).toHaveBeenCalledTimes(3);
    expect(q.getSnapshot().map((i) => i.state)).toEqual(["uploading", "uploading", "uploading", "queued"]);

    pending[0].opts.onProgress(2);
    expect(q.getSnapshot()[0].loaded).toBe(2);
    pending[0].resolve();
    await tick();
    expect(upload).toHaveBeenCalledTimes(4);
    pending.slice(1).forEach((p) => p.resolve());
    await tick();
    expect(q.getSnapshot().every((i) => i.state === "done")).toBe(true);
    expect(q.isActive()).toBe(false);
    expect(onDrain).toHaveBeenCalledTimes(1);
  });

  it("maps errors to plain language, retries and cancels", async () => {
    const { upload, pending } = controlledUploader();
    const q = new UploadQueue({ upload });
    q.add(files("big", "full", "c"));
    await tick();
    pending[0].reject(new ApiError(413, "file_too_large"));
    pending[1].reject(new ApiError(507, "quota_exceeded"));
    q.cancel(q.getSnapshot()[2].id);
    await tick();
    expect(q.getSnapshot().map((i) => [i.state, i.error])).toEqual([
      ["error", "upload.error.tooLarge"],
      ["error", "upload.error.quota"],
      ["canceled", undefined],
    ]);
    q.retry(q.getSnapshot()[0].id);
    await tick();
    expect(q.getSnapshot()[0].state).toBe("uploading");
    expect(upload).toHaveBeenCalledTimes(4);
  });
});
