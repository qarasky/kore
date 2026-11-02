"use client";
import { Check, ChevronDown, Search, Star } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useModelChoice } from "@/lib/contexts";
import { quick, spring } from "@/lib/motion";
import Link from "next/link";
import { ProviderIcon } from "./ProviderIcon";
import { chipLabel, filterModels, initialRail, railDimmed, railNotice, thinkingLabel } from "@/lib/model-picker";
import { t } from "@/lib/strings";

export function ModelPicker() {
  const { providers, favorites, choice, select, setThinking, toggleFavorite } = useModelChoice();
  const [open, setOpen] = useState(false);
  const [rail, setRail] = useState<string>("favorites");
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);

  const current = useMemo(() => {
    const p = providers.find((x) => x.id === choice?.providerId);
    return { provider: p, model: p?.models.find((m) => m.id === choice?.modelId) };
  }, [providers, choice]);

  useEffect(() => { if (open) setRail(initialRail(providers, favorites, choice)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = filterModels(providers, favorites, rail, query);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if ((e.metaKey || e.ctrlKey) && /^[1-3]$/.test(e.key)) {
        const row = rows[Number(e.key) - 1];
        if (row) { e.preventDefault(); select(row.providerId, row.model.id); setOpen(false); }
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, rows, select]);

  const levels = current.model?.thinkingLevels ?? [];
  const railProvider = providers.find((p) => p.id === rail);
  const notice = railProvider ? railNotice(railProvider) : null;

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}
        className="flex min-h-control-sm items-center gap-1 rounded-ui px-2 text-meta text-muted hover:bg-raised hover:text-text">
        <span className="max-w-40 truncate text-text">{current.model?.name ?? t.chooseModel}</span>
        {choice?.thinking && <span>{thinkingLabel(choice.thinking)}</span>}
        <ChevronDown size={14} aria-hidden />
        <span className="sr-only">{chipLabel(current.model?.name ?? t.chooseModel, choice?.thinking)}</span>
      </button>

      <AnimatePresence>
      {open && (
        <motion.div role="dialog" aria-label={t.searchModels}
          initial={{ opacity: 0, scale: 0.96, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0, transition: quick }} exit={{ opacity: 0, scale: 0.97, y: 4, transition: { duration: 0.1 } }}
          style={{ transformOrigin: "bottom left" }}
          className="absolute bottom-full left-0 z-30 mb-2 flex w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-ui border border-border bg-surface shadow-2xl">
          <div className="flex w-14 flex-col items-center gap-2 border-r border-border py-3">
            <RailButton active={rail === "favorites"} label={t.favorites} onClick={() => setRail("favorites")}><Star size={20} /></RailButton>
            <div className="w-8 border-t border-border" />
            {providers.map((p) => (
              <RailButton key={p.id} active={rail === p.id} dimmed={railDimmed(p)} label={railDimmed(p) ? `${p.name}, ${p.status === "disabled" ? t.railOff : t.railNotConnected}` : p.name} onClick={() => setRail(p.id)}>
                <ProviderIcon id={p.id} name={p.name} size={22} />
              </RailButton>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col p-3">
            <label className="flex items-center gap-2 border-b-2 border-accent pb-2 text-sub text-muted">
              <Search size={16} aria-hidden />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.searchModels} className="w-full bg-transparent text-text outline-none placeholder:text-muted" />
            </label>
            <ul className="mt-2 max-h-64 overflow-y-auto">
              {notice && (
                <li className="flex flex-col items-start gap-3 px-2 py-3 text-meta text-muted">
                  <span>{notice}</span>
                  <Link href="/settings#providers" onClick={() => setOpen(false)} className="rounded-ui bg-raised px-3 py-2 text-sub text-text hover:bg-border">{t.openSettings}</Link>
                </li>
              )}
              {!notice && rows.length === 0 && <li className="px-2 py-3 text-meta text-muted">{rail === "favorites" && !query ? t.noFavorites : t.noModels}</li>}
              {rows.map((r, i) => {
                const active = r.providerId === choice?.providerId && r.model.id === choice?.modelId;
                return (
                  <motion.li key={r.key} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.12, delay: Math.min(i, 8) * 0.012 }} className={`flex min-h-control items-center gap-1 rounded-ui pr-1 ${active ? "bg-raised" : "hover:bg-raised/60"}`}>
                    <button type="button" onClick={() => { select(r.providerId, r.model.id); setOpen(false); }} className="flex min-h-control flex-1 items-center gap-2 px-2 text-left text-sub">
                      <span className="truncate">{r.model.name}</span>
                      {r.model.free && <span className="shrink-0 rounded-full border border-border px-1.5 text-2xs text-muted">{t.freeTag}</span>}
                      {!r.model.vision && <span className="shrink-0 text-2xs text-muted">{t.noPhotos}</span>}
                    </button>
                    {i < 3 && <kbd className="rounded-md bg-border px-1.5 py-0.5 text-2xs text-muted">⌘{i + 1}</kbd>}
                    <button type="button" aria-label={favorites.includes(r.key) ? t.removeFavorite : t.addFavorite} onClick={() => void toggleFavorite(r.key)} className="grid size-control-sm place-items-center text-muted hover:text-text">
                      <Star size={16} className={favorites.includes(r.key) ? "fill-accent text-accent" : ""} />
                    </button>
                    {active && <Check size={16} className="mr-2 text-text" aria-hidden />}
                  </motion.li>
                );
              })}
            </ul>
            {levels.length > 0 && (
              <div className="mt-2 border-t border-border pt-2">
                <div className="mb-1 text-2xs text-muted">{t.thinkingLevel}</div>
                <div className="flex flex-wrap gap-1">
                  {[undefined, ...levels].map((l) => (
                    <button key={l ?? "default"} type="button" onClick={() => setThinking(l)}
                      className={`min-h-control-sm rounded-ui px-3 text-meta ${choice?.thinking === l ? "bg-accent text-white" : "bg-raised text-text hover:bg-border"}`}>
                      {l ? thinkingLabel(l) : t.thinkingDefault}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

function RailButton({ active, dimmed = false, label, onClick, children }: { active: boolean; dimmed?: boolean; label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={`relative grid min-h-control w-full place-items-center text-text transition-opacity ${dimmed ? "opacity-40 hover:opacity-70" : ""}`}>
      {children}
      {active && <motion.span layoutId="rail-marker" transition={spring} className="absolute right-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-accent" />}
    </button>
  );
}
