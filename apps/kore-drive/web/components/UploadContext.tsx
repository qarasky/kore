"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { planUploads, type DropSet } from "@/lib/dropEntries";
import { t } from "@/lib/i18n";
import { isFileDrag } from "@/lib/moveDrag";
import { chunkBytesOverride, type UploadTarget } from "@/lib/upload";
import { UploadQueue } from "@/lib/uploadQueue";
import { useToast } from "./Toast";
import { UploadTray } from "./UploadTray";

type Uploads = {
  queue: UploadQueue;
  /** Recreates the folders of `set` under `root`, then queues its files. */
  upload: (set: DropSet, root: UploadTarget) => Promise<void>;
};

const UploadContext = createContext<Uploads | null>(null);

/**
 * Owns the app-wide upload queue and the tray. Refreshes server data once
 * whenever the queue drains, warns before leaving the page while uploads
 * run, and stops a file dropped outside a drop zone from opening in the tab.
 */
export function UploadProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [queue] = useState(() => new UploadQueue({ concurrency: 3, chunkBytes: chunkBytesOverride }));

  useEffect(() => {
    queue.setOnDrain(() => router.refresh());
    return () => queue.setOnDrain(undefined);
  }, [queue, router]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!queue.isActive()) return;
      e.preventDefault();
      e.returnValue = t("upload.leaveWarning"); // legacy browsers; modern ones show their own text
    };
    // Files dropped where no drop zone accepted them would replace the page.
    const swallow = (e: DragEvent) => {
      if (e.defaultPrevented || !isFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, [queue]);

  const value = useMemo<Uploads>(
    () => ({
      queue,
      upload: async (set, root) => {
        if (set.files.length === 0 && set.dirs.length === 0) return;
        let plan;
        try {
          plan = await planUploads(set, root);
        } catch {
          toast.show({ message: t("upload.error.generic"), tone: "error" });
          return;
        }
        if (plan.failedFolders.length > 0) {
          toast.show({ message: t("upload.folderFailed", { name: plan.failedFolders[0] }), tone: "error" });
        }
        if (plan.files.length > 0) queue.add(plan.files);
        else router.refresh(); // only (empty) folders were created
      },
    }),
    [queue, router, toast],
  );

  return (
    <UploadContext value={value}>
      {children}
      <UploadTray queue={queue} />
    </UploadContext>
  );
}

export function useUploads(): Uploads {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUploads() outside <UploadProvider>");
  return ctx;
}
