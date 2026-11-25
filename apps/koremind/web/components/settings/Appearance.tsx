"use client";
import { SettingsSection, ThemeSwitcher } from "@qarasky/kore-ui";
import { t } from "@/lib/strings";

/** Color (the default), Light, Dark or follow the device. The choice applies at once and stays on this device. */
export function AppearanceSection() {
  return (
    <SettingsSection title={t.appearance} description={t.appearanceHint}>
      <ThemeSwitcher aria-label={t.appearance} />
    </SettingsSection>
  );
}
