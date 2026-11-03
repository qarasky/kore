"use client";
import type { Settings } from "@koremind/shared";
import { Brain, CircleUser, Cpu, Plug, UserRound, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { AccountSection } from "@/components/settings/Account";
import { MemorySection } from "@/components/settings/Memory";
import { ModelsSection } from "@/components/settings/Models";
import { PersonalizationSection } from "@/components/settings/Personalization";
import { ProvidersSection } from "@/components/settings/Providers";
import { Shell } from "@/components/Shell";
import { useModelChoice } from "@/lib/contexts";
import { quick, smooth, spring } from "@/lib/motion";
import { SECTIONS, isSection, type SectionId } from "@/lib/settings-model";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";
import { useAutosave } from "@/lib/use-autosave";

const ICONS: Record<SectionId, LucideIcon> = { models: Cpu, providers: Plug, personalization: UserRound, memory: Brain, account: CircleUser };

export default function SettingsPage() {
  const { api } = useSession();
  const { providers, favorites, toggleFavorite, reload } = useModelChoice();
  const [section, setSection] = useState<SectionId>("models");
  const [settings, setSettings] = useState<Settings | null>(null);
  const save = useAutosave(settings, (s) => api!.putSettings(s));

  useEffect(() => { api?.settings().then(setSettings).catch(() => {}); }, [api]);
  // The picker follows what was just saved (provider switches, free-only).
  useEffect(() => { if (save === "saved") void reload(); }, [save]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const read = () => { const h = window.location.hash.slice(1); if (isSection(h)) setSection(h); };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const go = (id: SectionId) => { setSection(id); window.history.replaceState(null, "", `#${id}`); };

  return (
    <Shell title={t.settings} right={<SaveBadge state={save} />}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 pb-12 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-10">
          <nav aria-label={t.settings} className="sticky top-0 z-10 -mx-4 mb-4 flex gap-1 overflow-x-auto bg-bg/90 px-4 py-2 backdrop-blur md:static md:mx-0 md:mb-0 md:flex-col md:overflow-visible md:bg-transparent md:px-0 md:py-1 md:backdrop-blur-none">
            {SECTIONS.map((s) => {
              const Icon = ICONS[s.id];
              const active = section === s.id;
              return (
                <button
                  key={s.id} type="button" onClick={() => go(s.id)} aria-current={active ? "page" : undefined}
                  className={`relative flex min-h-control shrink-0 items-center gap-2 rounded-ui px-3 text-sub transition-colors ${active ? "text-text" : "text-muted hover:text-text"}`}
                >
                  {active && <motion.span layoutId="settings-nav-pill" transition={spring} className="absolute inset-0 rounded-ui bg-raised" />}
                  <Icon size={16} aria-hidden className="relative" />
                  <span className="relative whitespace-nowrap">{s.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 max-w-xl pt-2 md:pt-1">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={section}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: smooth }} exit={{ opacity: 0, y: -4, transition: quick }}
              >
                {section === "models" && <ModelsSection providers={providers} favorites={favorites} toggleFavorite={toggleFavorite} />}
                {section === "providers" && <ProvidersSection settings={settings} onChange={setSettings} />}
                {section === "personalization" && settings && <PersonalizationSection settings={settings} onChange={setSettings} />}
                {section === "memory" && settings && <MemorySection settings={settings} onChange={setSettings} />}
                {section === "account" && <AccountSection />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function SaveBadge({ state }: { state: ReturnType<typeof useAutosave> }) {
  return (
    <div className="flex h-control items-center justify-end text-2xs text-muted" role="status" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        {state !== "idle" && (
          <motion.span key={state} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={quick} className={state === "error" ? "text-danger" : ""}>
            {state === "saving" ? t.autoSaving : state === "saved" ? t.autoSaved : t.autoError}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
