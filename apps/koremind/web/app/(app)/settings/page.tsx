"use client";
import type { Settings } from "@koremind/shared";
import { PageHeader, SaveStatus, SettingsLayout } from "@qarasky/kore-ui";
import { Brain, CircleUser, Cpu, Palette, Plug, UserRound, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { AccountSection } from "@/components/settings/Account";
import { AppearanceSection } from "@/components/settings/Appearance";
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

const ICONS: Record<SectionId, LucideIcon> = { models: Cpu, providers: Plug, personalization: UserRound, appearance: Palette, memory: Brain, account: CircleUser };

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
    <>
      <PageHeader title={t.settings} actions={<SaveStatus state={save} labels={{ saving: t.autoSaving, saved: t.autoSaved, error: t.autoError }} />} />
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
            {section === "appearance" && <AppearanceSection />}
            {section === "memory" && settings && <MemorySection settings={settings} onChange={setSettings} />}
            {section === "account" && <AccountSection />}
          </motion.div>
        </AnimatePresence>
      </SettingsLayout>
    </>
  );
}
