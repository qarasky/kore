"use client";
import type { Attachment } from "@koremind/shared";
import { IconButton, InlineMessage, Textarea } from "@qarasky/kore-ui";
import { ArrowUp, Square } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AttachMenu } from "./AttachMenu";
import { AttachmentStrip } from "./AttachmentStrip";
import { EffortControl } from "./EffortControl";
import { ModelPicker } from "./ModelPicker";
import { canSend } from "@/lib/chat-state";
import { pop } from "@/lib/motion";
import { useModelChoice } from "@/lib/contexts";
import { lacksVision } from "@/lib/model-picker";
import { addUploading, markFailed, markReady, readyAttachments, removePending, retrying, uploadingCount, type PendingFile } from "@/lib/pending-files";
import { useSession } from "@/lib/session";
import { uploadSizeError } from "@/lib/upload";
import { t } from "@/lib/strings";

export function Composer({ busy, onSend, onStop }: { busy: boolean; onSend(text: string, attachments: Attachment[]): void; onStop(): void }) {
  const { api } = useSession();
  const { providers, choice } = useModelChoice();
  const model = providers.find((p) => p.id === choice?.providerId)?.models.find((m) => m.id === choice?.modelId);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [error, setError] = useState("");
  const latest = useRef(files);
  latest.current = files;
  const revoke = (f: PendingFile | undefined) => { if (f?.preview) URL.revokeObjectURL(f.preview); };
  useEffect(() => () => latest.current.forEach(revoke), []);

  async function upload(key: string, file: File) {
    try { const a = await api!.upload(file); setFiles((cur) => markReady(cur, key, a)); }
    catch (e) { setFiles((cur) => markFailed(cur, key, e instanceof Error ? e.message : t.genericError)); }
  }

  /** Every picked file shows up at once (with a thumbnail for photos) and uploads in the background. */
  function pick(list: File[]) {
    if (!api) return;
    setError("");
    for (const f of list) {
      const tooBig = uploadSizeError(f.size);
      if (tooBig) { setError(tooBig); continue; }
      const key = crypto.randomUUID();
      const preview = f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined;
      setFiles((cur) => addUploading(cur, { key, name: f.name, mime: f.type || "application/octet-stream", size: f.size, preview, file: f }));
      void upload(key, f);
    }
  }
  function remove(key: string) {
    revoke(files.find((f) => f.key === key));
    setFiles((cur) => removePending(cur, key));
  }
  function retry(key: string) {
    const f = files.find((x) => x.key === key);
    if (!f?.file) return;
    setFiles((cur) => retrying(cur, key));
    void upload(key, f.file);
  }

  const ready = readyAttachments(files);
  const sendable = (text: string) => canSend({ text, fileCount: ready.length, uploading: uploadingCount(files), busy, hasModel: !!model });
  function submit() {
    const v = text.trim();
    if (!sendable(v)) return;
    onSend(v, ready);
    setText("");
    files.forEach(revoke);
    setFiles([]);
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };

  const notice = error || (!model ? t.noModel : "") || (lacksVision(files.filter((f) => f.state !== "failed"), model) ? t.noPhotosWarning : "");

  // Chat-specific: a multi-line field styled like a kore-ui input (bg/60, hairline, accent border + ring on focus) that holds
  // the attachments, the model picker and the send button.
  return (
    <div className="mx-auto w-full max-w-reading px-3 pb-3 md:px-4 md:pb-4">
      <div className="rounded-overlay border border-border bg-bg/60 p-2 transition-colors hover:border-border-strong focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25 focus-within:hover:border-accent">
        <AttachmentStrip files={files} onRemove={remove} onRetry={retry} />
        <Textarea
          autoGrow
          maxHeight={200}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          placeholder={t.composerPlaceholder}
          aria-label={t.composerPlaceholder}
          className="rounded-none border-0 bg-transparent px-2 hover:border-0 focus:border-0 focus:ring-0"
        />
        <div className="flex items-center gap-1">
          <AttachMenu onFiles={pick} />
          <ModelPicker />
          <EffortControl />
          <div className="flex-1" />
          <AnimatePresence initial={false} mode="popLayout">
            {busy ? (
              <motion.span key="stop" variants={pop} initial="hidden" animate="show" exit="exit" className="flex">
                <IconButton label={t.stop} icon={<Square className="size-3.5" fill="currentColor" />} variant="secondary" size="md" onClick={onStop} />
              </motion.span>
            ) : (
              <motion.span key="send" variants={pop} initial="hidden" animate="show" exit="exit" className="flex">
                <IconButton label={t.send} icon={<ArrowUp />} variant="primary" size="md" onClick={submit} disabled={!sendable(text)} />
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
      {notice && <InlineMessage animated className="mt-2 px-2">{notice}</InlineMessage>}
    </div>
  );
}
