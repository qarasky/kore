"use client";
import type { Settings } from "@koremind/shared";
import { PageHeader, SettingsLayout } from "@qarasky/kore-ui";
import { Brain, CircleUser, Cpu, Plug, UserRound, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { AccountSection } from "@/components/settings/Account";
import { MemorySection } from "@/components/settings/Memory";
import { ModelsSection } from "@/components/settings/Models";
import { PersonalizationSection } from "@/components/settings/Personalization";
import { ProvidersSection } from "@/components/settings/Providers";
import { useModelChoice } from "@/lib/contexts";
import { quick, smooth } from "@/lib/motion";
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
  // On phones the section nav is a scrolling pill row: keep the current pill in view (e.g. opened at #account).
  useEffect(() => {
    document.querySelector(`nav[aria-label="${t.settingsSections}"] [aria-current="page"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [section]);

  return (
    <>
      <PageHeader title={t.settings} actions={<SaveBadge state={save} />} />
      <SettingsLayout
        navLabel={t.settingsSections}
        current={section}
        items={SECTIONS.map((s) => { const Icon = ICONS[s.id]; return { id: s.id, label: s.label, icon: <Icon />, onSelect: () => go(s.id) }; })}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={section} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: smooth }} exit={{ opacity: 0, y: -4, transition: quick }}>
            {section === "models" && <ModelsSection providers={providers} favorites={favorites} toggleFavorite={toggleFavorite} />}
            {section === "providers" && <ProvidersSection settings={settings} onChange={setSettings} />}
            {section === "personalization" && settings && <PersonalizationSection settings={settings} onChange={setSettings} />}
            {section === "memory" && settings && <MemorySection settings={settings} onChange={setSettings} />}
            {section === "account" && <AccountSection />}
          </motion.div>
        </AnimatePresence>
      </SettingsLayout>
    </>
  );
}

/** Autosave status in words ("Saving…" → "Saved"), as kore-ui's DESIGN asks for settings that apply as you go. */
function SaveBadge({ state }: { state: ReturnType<typeof useAutosave> }) {
  return (
    <div className="flex h-control-sm items-center text-meta text-muted" role="status" aria-live="polite">
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
