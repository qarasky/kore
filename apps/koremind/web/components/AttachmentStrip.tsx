"use client";
import { IconButton, Spinner, cn } from "@qarasky/kore-ui";
import { FileText, RotateCw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { pop, spring } from "@/lib/motion";
import type { PendingFile } from "@/lib/pending-files";
import { t } from "@/lib/strings";

/** The files picked for the next message, above the text: a horizontally scrolling row of thumbnails with their upload state. */
export function AttachmentStrip({ files, onRemove, onRetry }: { files: PendingFile[]; onRemove(key: string): void; onRetry(key: string): void }) {
  return (
    <div className="relative flex gap-2 overflow-x-auto px-1 pt-1 empty:hidden">
      <AnimatePresence initial={false} mode="popLayout">
        {files.map((f) => (
          <motion.div
            key={f.key} layout transition={spring} variants={pop} initial="hidden" animate="show" exit="exit"
            className={cn("relative mb-1 size-16 shrink-0 overflow-hidden rounded-ui border bg-raised", f.state === "failed" ? "border-danger" : "border-border")}
          >
            {f.preview ? (
              <img src={f.preview} alt={f.name} className="size-full object-cover" />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-1 p-1 text-muted">
                <FileText className="size-5" aria-hidden />
                <span className="w-full truncate text-center text-2xs">{f.name}</span>
              </div>
            )}
            {f.state === "uploading" && (
              <div className="absolute inset-0 grid place-items-center bg-bg/60"><Spinner size={20} label={t.uploading} /></div>
            )}
            {f.state === "failed" && (
              <div className="absolute inset-0 grid place-items-center bg-bg/70" title={f.error ?? t.uploadFailed}>
                <IconButton label={`${t.retry} ${f.name}`} icon={<RotateCw />} onClick={() => onRetry(f.key)} />
              </div>
            )}
            <IconButton label={t.removeFile(f.name)} icon={<X />} tooltip={false} onClick={() => onRemove(f.key)} className="absolute right-0.5 top-0.5 size-6 bg-bg/70" />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
