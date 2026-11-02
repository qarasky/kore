"use client";
import type { Attachment } from "@zero/shared";
import { ArrowUp, FileText, Paperclip, Square, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState, type KeyboardEvent } from "react";
import { ModelPicker } from "./ModelPicker";
import { ErrorText } from "./ui";
import { canSend } from "@/lib/chat-state";
import { pop, quick, spring } from "@/lib/motion";
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

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="rounded-[20px] border border-border bg-surface p-2 focus-within:border-border-strong">
        <div className="flex flex-wrap gap-2 px-1 pt-1 empty:hidden">
          <AnimatePresence initial={false} mode="popLayout">
            {files.map((f) => (
              <motion.span key={f.id} layout transition={spring} variants={pop} initial="hidden" animate="show" exit="exit" className="mb-2 flex items-center gap-1 rounded-ui bg-raised py-1 pl-2 pr-1 text-meta">
                {f.mime.startsWith("image/") ? <img src={api?.uploadUrl(f.id)} alt="" className="size-5 rounded object-cover" /> : <FileText size={14} aria-hidden />}
                <span className="max-w-32 truncate">{f.name}</span>
                <button type="button" aria-label={t.delete} onClick={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))} className="grid size-5 place-items-center text-muted hover:text-text"><X size={14} /></button>
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
          className="block max-h-[200px] w-full resize-none bg-transparent px-2 py-2 text-heading text-text outline-none placeholder:text-muted"
        />
        <div className="flex items-center gap-1">
          <input ref={input} type="file" multiple accept="image/*,application/pdf,text/*,application/json" hidden onChange={(e) => void pick(e.target.files)} />
          <button type="button" aria-label={t.attach} title={t.attach} onClick={() => input.current?.click()} className="grid size-control-sm place-items-center rounded-ui text-muted hover:bg-raised hover:text-text"><Paperclip size={18} /></button>
          <ModelPicker />
          <div className="flex-1" />
          <AnimatePresence initial={false} mode="popLayout">
            {busy ? (
              <motion.button key="stop" type="button" aria-label={t.stop} onClick={onStop} variants={pop} initial="hidden" animate="show" exit="exit" whileTap={{ scale: 0.92 }} className="grid size-control place-items-center rounded-full bg-text text-bg"><Square size={14} fill="currentColor" /></motion.button>
            ) : (
              <motion.button key="send" type="button" aria-label={t.send} onClick={submit} disabled={!canSend({ text, fileCount: files.length, uploading, busy, hasModel: !!model })} variants={pop} initial="hidden" animate="show" exit="exit" whileTap={{ scale: 0.92 }} className="grid size-control place-items-center rounded-full bg-accent text-white transition-opacity hover:bg-accent-hover disabled:opacity-40"><ArrowUp size={20} /></motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="mt-2 px-2">
        <ErrorText>{error || (!model ? t.noModel : "") || (lacksVision(files, model) ? t.noPhotosWarning : "")}</ErrorText>
      </div>
    </div>
  );
}
