"use client";
import type { MemoryEntry, Settings } from "@zero/shared";
import { Brain, Pencil, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Card, SectionHeader, Switch } from "./parts";
import { Button } from "@/components/ui";
import { fadeUp, spring } from "@/lib/motion";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";

export function MemorySection({ settings, onChange }: { settings: Settings; onChange(s: Settings): void }) {
  const { api } = useSession();
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const load = () => api?.memory().then(setEntries).catch(() => setEntries([]));
  useEffect(() => { void load(); }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section>
      <SectionHeader title={t.memory} hint={t.memoryHint} />
      <Card className="mb-4 flex min-h-row items-center justify-between gap-4 px-4">
        <div>
          <p className="text-sub">{t.memoryOn}</p>
          {entries && <p className="text-2xs text-muted">{t.memoryCount(entries.length)}</p>}
        </div>
        <Switch checked={settings.memoryEnabled} onChange={(v) => onChange({ ...settings, memoryEnabled: v })} label={t.memoryOn} />
      </Card>

      {entries && entries.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-ui border border-dashed border-border px-6 py-10 text-center">
          <Brain size={22} className="text-muted" aria-hidden />
          <p className="text-meta text-muted">{t.memoryEmpty}</p>
        </div>
      )}
      <ul className="flex flex-col gap-2">
        <AnimatePresence initial={false} mode="popLayout">
          {(entries ?? []).map((e) => (
            <motion.li key={e.id} layout transition={spring} variants={fadeUp} initial="hidden" animate="show" exit="exit" className="rounded-ui border border-border bg-surface p-3">
              {editing?.id === e.id ? (
                <div className="flex flex-col gap-2">
                  <textarea autoFocus rows={2} value={editing.text} onChange={(ev) => setEditing({ id: e.id, text: ev.target.value })} className="w-full rounded-ui border border-border bg-bg px-3 py-2 text-sub focus:border-accent" />
                  <div className="flex gap-2">
                    <Button onClick={async () => { await api?.updateMemory(e.id, editing.text); setEditing(null); await load(); }}>{t.save}</Button>
                    <Button variant="ghost" onClick={() => setEditing(null)}>{t.cancel}</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <span className="py-1 text-sub">{e.text}</span>
                  <span className="flex shrink-0">
                    <button type="button" aria-label={t.edit} onClick={() => setEditing({ id: e.id, text: e.text })} className="grid size-control-sm place-items-center rounded-ui text-muted hover:bg-raised hover:text-text"><Pencil size={15} /></button>
                    <button type="button" aria-label={t.delete} onClick={async () => { await api?.deleteMemory(e.id); await load(); }} className="grid size-control-sm place-items-center rounded-ui text-muted hover:bg-raised hover:text-danger"><Trash2 size={15} /></button>
                  </span>
                </div>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}
