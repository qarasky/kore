"use client";
import type { MemoryEntry, Settings } from "@zero/shared";
import { ChevronLeft, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Button } from "@/components/ui";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";

export default function MemoryPage() {
  const { api } = useSession();
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const load = () => api?.memory().then(setEntries).catch(() => {});
  useEffect(() => { void load(); api?.settings().then(setSettings).catch(() => {}); }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Shell title={t.memory}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-xl px-4 pb-10">
          <Link href="/settings" className="mb-3 inline-flex min-h-control items-center gap-1 text-meta text-muted hover:text-text"><ChevronLeft size={16} aria-hidden />{t.settings}</Link>
          <p className="mb-4 text-sub text-muted">{t.memoryHint}</p>
          {settings && (
            <label className="mb-4 flex min-h-control items-center justify-between rounded-ui bg-surface px-3 text-sub">
              {t.memoryOn}
              <input type="checkbox" checked={settings.memoryEnabled} onChange={async (e) => setSettings(await api!.putSettings({ ...settings, memoryEnabled: e.target.checked }))} className="size-5 accent-[#5b8def]" />
            </label>
          )}
          {entries.length === 0 && <p className="text-meta text-muted">{t.memoryEmpty}</p>}
          <ul className="flex flex-col gap-2">
            {entries.map((e) => (
              <li key={e.id} className="rounded-ui bg-surface p-3">
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
                    <span className="text-sub">{e.text}</span>
                    <span className="flex shrink-0">
                      <button type="button" aria-label={t.edit} onClick={() => setEditing({ id: e.id, text: e.text })} className="grid size-control-sm place-items-center text-muted hover:text-text"><Pencil size={15} /></button>
                      <button type="button" aria-label={t.delete} onClick={async () => { await api?.deleteMemory(e.id); await load(); }} className="grid size-control-sm place-items-center text-muted hover:text-danger"><Trash2 size={15} /></button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Shell>
  );
}
