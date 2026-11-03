"use client";
import type { Settings } from "@koremind/shared";
import { Field, Input, SettingsSection, Textarea } from "@qarasky/kore-ui";
import { ToggleChip } from "@/components/ToggleChip";
import { TONE_PRESETS, activePreset, togglePreset } from "@/lib/settings-model";
import { t } from "@/lib/strings";

export function PersonalizationSection({ settings, onChange }: { settings: Settings; onChange(s: Settings): void }) {
  const preset = activePreset(settings.tone);
  return (
    <SettingsSection title={t.personalization} description={t.personalizationHint}>
      <Field label={t.displayName}>
        <Input maxLength={60} value={settings.displayName} onChange={(e) => onChange({ ...settings, displayName: e.target.value })} />
      </Field>
      <div className="flex flex-col gap-1.5">
        <p className="text-meta font-medium text-muted" id="tone-label">{t.tone}</p>
        <div role="group" aria-labelledby="tone-label" className="flex flex-wrap gap-2">
          {TONE_PRESETS.map((p) => (
            <ToggleChip key={p.id} pressed={preset === p.id} onClick={() => onChange({ ...settings, tone: togglePreset(settings.tone, p.id) })}>{p.label}</ToggleChip>
          ))}
        </div>
      </div>
      <Field label={t.toneCustom} hint={t.toneHint}>
        <Input maxLength={200} value={preset ? "" : settings.tone} placeholder={preset ? TONE_PRESETS.find((p) => p.id === preset)?.tone : undefined} onChange={(e) => onChange({ ...settings, tone: e.target.value })} />
      </Field>
      <Field label={t.about} labelAside={`${settings.about.length}/600`}>
        <Textarea rows={4} maxLength={600} value={settings.about} onChange={(e) => onChange({ ...settings, about: e.target.value })} />
      </Field>
    </SettingsSection>
  );
}
