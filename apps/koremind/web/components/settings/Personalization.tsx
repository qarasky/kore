"use client";
import type { Settings } from "@zero/shared";
import { Card, Chip, SectionHeader } from "./parts";
import { Field } from "@/components/ui";
import { TONE_PRESETS, activePreset, togglePreset } from "@/lib/settings-model";
import { t } from "@/lib/strings";

export function PersonalizationSection({ settings, onChange }: { settings: Settings; onChange(s: Settings): void }) {
  const preset = activePreset(settings.tone);
  return (
    <section>
      <SectionHeader title={t.personalization} hint={t.personalizationHint} />
      <Card className="flex flex-col gap-5 p-4">
        <Field label={t.displayName} maxLength={60} value={settings.displayName} onChange={(e) => onChange({ ...settings, displayName: e.target.value })} />
        <div>
          <p className="mb-2 text-meta text-muted" id="tone-label">{t.tonePresets}</p>
          <div role="group" aria-labelledby="tone-label" className="flex flex-wrap gap-2">
            {TONE_PRESETS.map((p) => (
              <Chip key={p.id} active={preset === p.id} onClick={() => onChange({ ...settings, tone: togglePreset(settings.tone, p.id) })}>{p.label}</Chip>
            ))}
          </div>
          <div className="mt-3">
            <Field label={t.toneCustom} hint={t.toneHint} maxLength={200} value={preset ? "" : settings.tone} placeholder={preset ? TONE_PRESETS.find((p) => p.id === preset)?.tone : undefined} onChange={(e) => onChange({ ...settings, tone: e.target.value })} />
          </div>
        </div>
        <label className="block">
          <span className="mb-1 block text-meta text-muted">{t.about}</span>
          <textarea rows={4} maxLength={600} value={settings.about} onChange={(e) => onChange({ ...settings, about: e.target.value })} className="w-full resize-y rounded-ui border border-border bg-surface px-3 py-2 text-sub focus:border-accent" />
          <span className="mt-1 block text-right text-2xs text-muted">{settings.about.length}/600</span>
        </label>
      </Card>
    </section>
  );
}
