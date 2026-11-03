"use client";
import { Badge, Button, IconButton, Input, Kbd, Popover, PopoverContent, PopoverTrigger, Tooltip, cn } from "@qarasky/kore-ui";
import { Check, ChevronDown, Search, Star } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ProviderIcon } from "./ProviderIcon";
import { ToggleChip } from "./ToggleChip";
import { useModelChoice } from "@/lib/contexts";
import { spring } from "@/lib/motion";
import { chipLabel, filterModels, initialRail, railDimmed, railNotice, thinkingLabel } from "@/lib/model-picker";
import { t } from "@/lib/strings";

/** The model chip in the composer and its picker: a kore-ui Popover with a provider rail, search, models and thinking level. */
export function ModelPicker() {
  const { providers, favorites, choice, select, setThinking, toggleFavorite } = useModelChoice();
  const [open, setOpen] = useState(false);
  const [rail, setRail] = useState<string>("favorites");
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);

  const current = useMemo(() => {
    const p = providers.find((x) => x.id === choice?.providerId);
    return { provider: p, model: p?.models.find((m) => m.id === choice?.modelId) };
  }, [providers, choice]);

  useEffect(() => { if (open) setRail(initialRail(providers, favorites, choice)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = filterModels(providers, favorites, rail, query);
  const pick = (providerId: string, modelId: string) => { select(providerId, modelId); setOpen(false); };
  // ⌘1–⌘3 pick the first three rows.
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && /^[1-3]$/.test(e.key)) {
      const row = rows[Number(e.key) - 1];
      if (row) { e.preventDefault(); pick(row.providerId, row.model.id); }
    }
  };

  const levels = current.model?.thinkingLevels ?? [];
  const railProvider = providers.find((p) => p.id === rail);
  const notice = railProvider ? railNotice(railProvider) : null;
  const name = current.model?.name ?? t.chooseModel;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 px-2 text-meta font-normal text-muted hover:text-text data-[state=open]:bg-white/5" aria-label={chipLabel(name, choice?.thinking)}>
          <span className="max-w-40 truncate text-text">{name}</span>
          {choice?.thinking && <span>{thinkingLabel(choice.thinking)}</span>}
          <ChevronDown aria-hidden className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top" align="start" flush aria-label={t.searchModels} onKeyDown={onKey}
        onOpenAutoFocus={(e) => { e.preventDefault(); search.current?.focus(); }}
        className="flex w-[min(440px,calc(100vw-16px))] overflow-hidden"
      >
        <div className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border py-2" role="group" aria-label={t.sectionProviders}>
          <RailButton active={rail === "favorites"} label={t.favorites} onClick={() => setRail("favorites")}><Star className="size-[18px]" /></RailButton>
          <div className="my-1 w-8 border-t border-border" />
          {providers.map((p) => (
            <RailButton key={p.id} active={rail === p.id} dimmed={railDimmed(p)} label={railDimmed(p) ? `${p.name}, ${p.status === "disabled" ? t.railOff : t.railNotConnected}` : p.name} onClick={() => setRail(p.id)}>
              <ProviderIcon id={p.id} name={p.name} size={20} />
            </RailButton>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-2">
          <Input ref={search} size="sm" variant="filled" leadingIcon={<Search />} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.searchModels} aria-label={t.searchModels} />
          <ul className="mt-2 max-h-72 overflow-y-auto">
            {notice && (
              <li className="flex flex-col items-start gap-3 px-2 py-3 text-meta text-muted">
                <span>{notice}</span>
                <Button asChild size="sm"><Link href="/settings#providers" onClick={() => setOpen(false)}>{t.openSettings}</Link></Button>
              </li>
            )}
            {!notice && rows.length === 0 && <li className="px-2 py-3 text-meta text-muted">{rail === "favorites" && !query ? t.noFavorites : t.noModels}</li>}
            {rows.map((r, i) => {
              const active = r.providerId === choice?.providerId && r.model.id === choice?.modelId;
              const fav = favorites.includes(r.key);
              return (
                <motion.li key={r.key} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.12, delay: Math.min(i, 8) * 0.012 }}
                  className={cn("flex min-h-control items-center gap-1 rounded-ui pr-1 transition-colors", active ? "bg-accent/10" : "hover:bg-white/5")}>
                  <button type="button" onClick={() => pick(r.providerId, r.model.id)} aria-current={active || undefined} className="flex min-h-control min-w-0 flex-1 items-center gap-2 rounded-ui px-2 text-left text-sub">
                    <span className="truncate">{r.model.name}</span>
                    {r.model.free && <Badge>{t.freeTag}</Badge>}
                    {!r.model.vision && <span className="shrink-0 text-2xs text-muted">{t.noPhotos}</span>}
                    {active && <Check aria-hidden className="ml-auto size-4 shrink-0 text-accent" />}
                  </button>
                  {i < 3 && <Kbd>⌘{i + 1}</Kbd>}
                  <IconButton label={fav ? t.removeFavorite : t.addFavorite} icon={<Star className={fav ? "fill-accent text-accent" : undefined} />} onClick={() => void toggleFavorite(r.key)} />
                </motion.li>
              );
            })}
          </ul>
          {levels.length > 0 && (
            <div className="mt-2 border-t border-border px-1 pt-2" role="group" aria-labelledby="thinking-level">
              <div id="thinking-level" className="mb-1.5 text-meta font-medium text-muted">{t.thinkingLevel}</div>
              <div className="flex flex-wrap gap-1">
                {[undefined, ...levels].map((l) => (
                  <ToggleChip key={l ?? "default"} pressed={choice?.thinking === l} onClick={() => setThinking(l)}>{l ? thinkingLabel(l) : t.thinkingDefault}</ToggleChip>
                ))}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RailButton({ active, dimmed = false, label, onClick, children }: { active: boolean; dimmed?: boolean; label: string; onClick(): void; children: ReactNode }) {
  return (
    <Tooltip content={label} side="right">
      <button type="button" onClick={onClick} aria-label={label} aria-pressed={active}
        className={cn("relative grid size-control place-items-center rounded-ui text-text transition-colors hover:bg-white/5", active && "bg-white/5", dimmed && "text-muted opacity-50 hover:opacity-80")}>
        {children}
        {active && <motion.span layoutId="rail-marker" transition={spring} className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />}
      </button>
    </Tooltip>
  );
}
