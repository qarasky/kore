import type { Attachment } from "@koremind/shared";

/** A file the user picked for the next message: shown at once, uploaded in the background. */
export type PendingFile = {
  key: string;
  name: string;
  mime: string;
  size: number;
  state: "uploading" | "ready" | "failed";
  attachment?: Attachment;
  error?: string;
  /** An object URL of the local image, so the thumbnail shows before the upload ends. */
  preview?: string;
  /** Kept so a failed upload can be retried. */
  file?: File;
};

const update = (list: PendingFile[], key: string, patch: (f: PendingFile) => PendingFile): PendingFile[] =>
  list.some((f) => f.key === key) ? list.map((f) => (f.key === key ? patch(f) : f)) : list;

export const addUploading = (list: PendingFile[], f: Omit<PendingFile, "state">): PendingFile[] => [...list, { ...f, state: "uploading" }];
export const markReady = (list: PendingFile[], key: string, attachment: Attachment): PendingFile[] => update(list, key, (f) => ({ ...f, state: "ready", attachment, error: undefined }));
export const markFailed = (list: PendingFile[], key: string, error: string): PendingFile[] => update(list, key, (f) => ({ ...f, state: "failed", error }));
export const retrying = (list: PendingFile[], key: string): PendingFile[] => update(list, key, (f) => ({ ...f, state: "uploading", error: undefined }));
export const removePending = (list: PendingFile[], key: string): PendingFile[] => (list.some((f) => f.key === key) ? list.filter((f) => f.key !== key) : list);

/** What gets sent: only the files that finished uploading, in pick order. */
export const readyAttachments = (list: PendingFile[]): Attachment[] => list.flatMap((f) => (f.state === "ready" && f.attachment ? [f.attachment] : []));
export const uploadingCount = (list: PendingFile[]): number => list.filter((f) => f.state === "uploading").length;

/** The reason to show for failed uploads: the latest failure's message, or [fallback] when it has none. Null when nothing failed. */
export function uploadNotice(list: PendingFile[], fallback: string): string | null {
  const failed = list.filter((f) => f.state === "failed");
  const last = failed[failed.length - 1];
  return last ? last.error || fallback : null;
}
