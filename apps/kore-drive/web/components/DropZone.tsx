"use client";

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { collectDataTransfer } from "@/lib/dropEntries";
import { t } from "@/lib/i18n";
import { isFileDrag } from "@/lib/moveDrag";
import type { UploadTarget } from "@/lib/upload";
import { useUploads } from "./UploadContext";

/**
 * Wraps the file list: files (and folders) dragged in from the OS show a
 * full-area "Drop files to upload" overlay and, when dropped, upload into
 * `target` (the folder on screen). Folder rows accept file drops themselves
 * (they call `preventDefault`), in which case this zone stands aside. Only
 * drags carrying "Files" count; in-page row drags are ignored here.
 */
export function DropZone({ target, children }: { target: UploadTarget; children: ReactNode }) {
  const uploads = useUploads();
  /** null: no file drag over us; otherwise the folder row under the pointer, if any. */
  const [over, setOver] = useState<{ folder: string | null } | null>(null);
  const depth = useRef(0);

  useEffect(() => {
    // A drop or cancel anywhere ends the drag, even if our handlers never saw it.
    const reset = () => {
      depth.current = 0;
      setOver(null);
    };
    window.addEventListener("drop", reset, true);
    window.addEventListener("dragend", reset, true);
    return () => {
      window.removeEventListener("drop", reset, true);
      window.removeEventListener("dragend", reset, true);
    };
  }, []);

  function folderUnder(e: DragEvent): string | null {
    const row = (e.target as Element | null)?.closest?.('[role="option"][data-kind="folder"]');
    return row?.getAttribute("data-name") ?? null;
  }

  return (
    <div
      data-testid="drop-zone"
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if (!isFileDrag(e)) return;
        depth.current++;
        setOver({ folder: folderUnder(e) });
      }}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        const folder = folderUnder(e);
        if (!over || over.folder !== folder) setOver({ folder });
        if (e.nativeEvent.defaultPrevented) return; // a folder row took it
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!isFileDrag(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(null);
      }}
      onDrop={(e) => {
        depth.current = 0;
        setOver(null);
        if (!isFileDrag(e) || e.nativeEvent.defaultPrevented) return;
        e.preventDefault();
        void uploads.upload(collectDataTransfer(e.dataTransfer), target);
      }}
    >
      {children}
      {over && (
        <div
          aria-hidden="true"
          data-testid="drop-overlay"
          className={
            "pointer-events-none absolute inset-0 z-20 flex items-end justify-center rounded-b-[8px] pb-8 " +
            (over.folder ? "" : "bg-accent/[0.06] ring-2 ring-accent/70 ring-inset")
          }
        >
          <div className="rounded-ui border border-accent/50 bg-raised px-4 py-2 font-medium shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)]">
            {over.folder ? t("drop.overlayInto", { name: over.folder }) : t("drop.overlay")}
          </div>
        </div>
      )}
    </div>
  );
}
