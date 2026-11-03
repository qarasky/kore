"use client";
import type { MemoryEntry, Settings } from "@koremind/shared";
import { Button, Card, EmptyState, IconButton, SettingsSection, Switch, Textarea } from "@qarasky/kore-ui";
import { Brain, Pencil, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
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
    <SettingsSection title={t.memory} description={t.memoryHint}>
      <Switch labelFirst label={t.memoryOn} description={entries ? t.memoryCount(entries.length) : undefined} checked={settings.memoryEnabled} onCheckedChange={(v) => onChange({ ...settings, memoryEnabled: v })} />
      {entries && entries.length === 0 && <Card><EmptyState icon={<Brain />} title={t.memoryEmpty} /></Card>}
      {entries && entries.length > 0 && (
        <Card>
          <ul>
            <AnimatePresence initial={false} mode="popLayout">
              {entries.map((e) => (
                <motion.li key={e.id} layout transition={spring} variants={fadeUp} initial="hidden" animate="show" exit="exit" className="border-b border-border px-4 py-2.5 last:border-b-0">
                  {editing?.id === e.id ? (
                    <div className="flex flex-col gap-2 py-1">
                      <Textarea autoFocus rows={2} aria-label={t.edit} value={editing.text} onChange={(ev) => setEditing({ id: e.id, text: ev.target.value })} />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => setEditing(null)}>{t.cancel}</Button>
                        <Button size="sm" variant="primary" onClick={async () => { await api?.updateMemory(e.id, editing.text); setEditing(null); await load(); }}>{t.save}</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <span className="py-1">{e.text}</span>
                      <span className="flex shrink-0">
                        <IconButton label={t.edit} icon={<Pencil />} onClick={() => setEditing({ id: e.id, text: e.text })} />
                        <IconButton label={t.delete} icon={<Trash2 />} variant="danger" onClick={async () => { await api?.deleteMemory(e.id); await load(); }} />
                      </span>
                    </div>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </Card>
      )}
    </SettingsSection>
  );
}
