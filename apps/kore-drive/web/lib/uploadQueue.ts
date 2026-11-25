/**
 * A small upload queue for the upload tray: up to `concurrency` files upload
 * at once (each file's chunks go one after another, see `uploadFile`), every
 * item has a state, and items can be canceled or retried. Framework-free; the
 * UI subscribes with `useSyncExternalStore(queue.subscribe, queue.getSnapshot)`.
 */
import { isApiError } from "./api";
import type { MessageKey } from "./i18n";
import { discardUpload, uploadFile, type UploadOptions, type UploadTarget } from "./upload";

export type UploadState = "queued" | "uploading" | "done" | "error" | "canceled";

export type UploadItem = {
  readonly id: number;
  readonly file: File;
  readonly target: UploadTarget;
  readonly state: UploadState;
  /** Bytes confirmed by the server. */
  readonly loaded: number;
  /** Plain-language reason when `state === "error"`. */
  readonly error?: MessageKey;
  /** The created node; may be unknown when the completion response was lost. */
  readonly nodeId?: string;
};

type Uploader = (file: File, target: UploadTarget, opts: UploadOptions) => Promise<{ nodeId?: string }>;

/** The tray message for a failed upload. */
export function uploadErrorKey(e: unknown): MessageKey {
  if (isApiError(e, 507)) return "upload.error.quota";
  if (isApiError(e, 413)) return e.code === "file_too_large" ? "upload.error.tooLarge" : "upload.error.generic";
  if (isApiError(e, 400) && e.code === "invalid_name") return "upload.error.invalidName";
  if (isApiError(e, 404) || (isApiError(e, 400) && e.code === "not_a_folder")) return "upload.error.destinationGone";
  if (isApiError(e, 401)) return "upload.error.signedOut";
  if (isApiError(e, 503)) return "upload.error.network";
  return "upload.error.generic";
}

export class UploadQueue {
  private items: UploadItem[] = [];
  private readonly controllers = new Map<number, AbortController>();
  private readonly listeners = new Set<() => void>();
  private seq = 0;
  /** Something finished since the queue last drained. */
  private settledSinceDrain = false;

  constructor(
    private readonly opts: {
      concurrency?: number;
      upload?: Uploader;
      /** Releases a failed item's kept server session (see `discardUpload`). */
      discard?: (file: File, target: UploadTarget) => Promise<void>;
      /** Read per file, so a `localStorage` override applies without a reload. */
      chunkBytes?: () => number | undefined;
      /** Called once each time the last running/queued item settles. */
      onDrain?: () => void;
    } = {},
  ) {}

  /** Replaces the drain callback (e.g. once a router is available). */
  setOnDrain(fn: (() => void) | undefined): void {
    this.opts.onDrain = fn;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): readonly UploadItem[] => this.items;

  /** True while any item is queued or uploading. */
  isActive(): boolean {
    return this.items.some((i) => i.state === "queued" || i.state === "uploading");
  }

  add(files: { file: File; target: UploadTarget }[]): void {
    if (files.length === 0) return;
    const added = files.map(({ file, target }): UploadItem => ({ id: ++this.seq, file, target, state: "queued", loaded: 0 }));
    this.items = [...this.items, ...added];
    this.emit();
    this.pump();
  }

  cancel(id: number): void {
    const item = this.find(id);
    if (!item) return;
    if (item.state === "queued") {
      this.patch(id, { state: "canceled" });
      this.settled();
    } else if (item.state === "uploading") {
      this.controllers.get(id)?.abort(); // the runner marks it canceled
    }
  }

  cancelAll(): void {
    for (const i of this.items) this.cancel(i.id);
  }

  /** Re-queues a failed (or canceled) item; a failed one resumes from the server's offset. */
  retry(id: number): void {
    const item = this.find(id);
    if (!item || (item.state !== "error" && item.state !== "canceled")) return;
    this.patch(id, { state: "queued", error: undefined, loaded: item.state === "canceled" ? 0 : item.loaded });
    this.pump();
  }

  /**
   * Removes finished items (done, error, canceled) from the list. Failed
   * items may still hold a resumable server session (and its quota
   * reservation); those are discarded.
   */
  clearFinished(): void {
    const discard = this.opts.discard ?? discardUpload;
    for (const i of this.items) {
      if (i.state === "error") void discard(i.file, i.target).catch(() => {});
    }
    this.items = this.items.filter((i) => i.state === "queued" || i.state === "uploading");
    this.emit();
  }

  private find(id: number) {
    return this.items.find((i) => i.id === id);
  }

  private patch(id: number, p: Partial<UploadItem>) {
    this.items = this.items.map((i) => (i.id === id ? { ...i, ...p } : i));
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private settled() {
    this.settledSinceDrain = true;
    this.pump();
  }

  private pump() {
    const limit = this.opts.concurrency ?? 3;
    let running = this.items.filter((i) => i.state === "uploading").length;
    for (const item of this.items) {
      if (running >= limit) break;
      if (item.state !== "queued") continue;
      running++;
      void this.run(item);
    }
    if (!this.isActive() && this.settledSinceDrain) {
      this.settledSinceDrain = false;
      this.opts.onDrain?.();
    }
  }

  private async run(item: UploadItem) {
    const ctl = new AbortController();
    this.controllers.set(item.id, ctl);
    this.patch(item.id, { state: "uploading" });
    const upload = this.opts.upload ?? uploadFile;
    try {
      const { nodeId } = await upload(item.file, item.target, {
        chunkBytes: this.opts.chunkBytes?.(),
        signal: ctl.signal,
        onProgress: (n) => {
          if (this.find(item.id)?.state === "uploading") this.patch(item.id, { loaded: n });
        },
      });
      this.patch(item.id, { state: "done", loaded: item.file.size, nodeId });
    } catch (e) {
      if (ctl.signal.aborted) this.patch(item.id, { state: "canceled" });
      else this.patch(item.id, { state: "error", error: uploadErrorKey(e) });
    } finally {
      this.controllers.delete(item.id);
      this.settled();
    }
  }
}
