"use client";
import type { Attachment } from "@koremind/shared";
import { IconButton } from "@qarasky/kore-ui";
import { ArrowUp, FileText, Paperclip, Square, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState, type KeyboardEvent } from "react";
import { ModelPicker } from "./ModelPicker";
import { InlineError } from "./InlineError";
import { canSend } from "@/lib/chat-state";
import { pop, spring } from "@/lib/motion";
import { useModelChoice } from "@/lib/contexts";
import { lacksVision } from "@/lib/model-picker";
import { useSession } from "@/lib/session";
import { uploadSizeError } from "@/lib/upload";
import { t } from "@/lib/strings";

export function Composer({ busy, onSend, onStop }: { busy: boolean; onSend(text: string, attachments: Attachment[]): void; onStop(): void }) {
  const { api } = useSession();
  const { providers, choice } = useModelChoice();
  const model = providers.find((p) => p.id === choice?.providerId)?.models.find((m) => m.id === choice?.modelId);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function pick(list: FileList | null) {
    if (!list || !api) return;
    setError("");
    for (const f of Array.from(list)) {
      const tooBig = uploadSizeError(f.size);
      if (tooBig) { setError(tooBig); continue; }
      setUploading((n) => n + 1);
      try { const a = await api.upload(f); setFiles((cur) => [...cur, a]); }
      catch (e) { setError(e instanceof Error ? e.message : t.genericError); }
      finally { setUploading((n) => n - 1); }
    }
    if (input.current) input.current.value = "";
  }

  function submit() {
    const v = text.trim();
    if (!canSend({ text: v, fileCount: files.length, uploading, busy, hasModel: !!model })) return;
    onSend(v, files);
    setText("");
    setFiles([]);
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };

  // Chat-specific: a multi-line field styled like a kore-ui input (bg/60, hairline, accent border + ring on focus) that holds
  // the attachments, the model picker and the send button.
  return (
    <div className="mx-auto w-full max-w-reading px-3 pb-3 md:px-4 md:pb-4">
      <div className="rounded-overlay border border-border bg-bg/60 p-2 transition-colors hover:border-border-strong focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25 focus-within:hover:border-accent">
        <div className="flex flex-wrap gap-2 px-1 pt-1 empty:hidden">
          <AnimatePresence initial={false} mode="popLayout">
            {files.map((f) => (
              <motion.span key={f.id} layout transition={spring} variants={pop} initial="hidden" animate="show" exit="exit" className="mb-1 flex h-control-sm items-center gap-1.5 rounded-ui border border-border bg-raised pl-2 text-meta">
                {f.mime.startsWith("image/") ? <img src={api?.uploadUrl(f.id)} alt="" className="size-5 rounded-[4px] object-cover" /> : <FileText className="size-4 text-muted" aria-hidden />}
                <span className="max-w-32 truncate">{f.name}</span>
                <IconButton label={`${t.delete} ${f.name}`} icon={<X />} tooltip={false} onClick={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))} className="size-7" />
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); e.currentTarget.style.height = "auto"; e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 200) + "px"; }}
          onKeyDown={onKey}
          rows={1}
          placeholder={t.composerPlaceholder}
          aria-label={t.composerPlaceholder}
          className="block max-h-[200px] w-full resize-none bg-transparent px-2 py-2 text-text outline-none placeholder:text-muted focus-visible:outline-none"
        />
        <div className="flex items-center gap-1">
          <input ref={input} type="file" multiple accept="image/*,application/pdf,text/*,application/json" hidden onChange={(e) => void pick(e.target.files)} />
          <IconButton label={t.attach} icon={<Paperclip />} onClick={() => input.current?.click()} />
          <ModelPicker />
          <div className="flex-1" />
          <AnimatePresence initial={false} mode="popLayout">
            {busy ? (
              <motion.span key="stop" variants={pop} initial="hidden" animate="show" exit="exit" className="flex">
                <IconButton label={t.stop} icon={<Square className="size-3.5" fill="currentColor" />} variant="secondary" size="md" onClick={onStop} />
              </motion.span>
            ) : (
              <motion.span key="send" variants={pop} initial="hidden" animate="show" exit="exit" className="flex">
                <IconButton label={t.send} icon={<ArrowUp />} variant="primary" size="md" onClick={submit} disabled={!canSend({ text, fileCount: files.length, uploading, busy, hasModel: !!model })} />
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="mt-2 px-2">
        <InlineError>{error || (!model ? t.noModel : "") || (lacksVision(files, model) ? t.noPhotosWarning : "")}</InlineError>
      </div>
    </div>
  );
}
