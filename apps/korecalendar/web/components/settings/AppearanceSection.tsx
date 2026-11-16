"use client";

import { SettingsSection, ThemeSwitcher } from "@qarasky/kore-ui";
import { t } from "@/lib/i18n";

/** The theme: Color (the original look), Light, Dark (OLED) or follow the device. Saved in this browser. */
export function AppearanceSection() {
  return (
    <SettingsSection title={t("appearance.heading")} description={t("appearance.intro")}>
      <ThemeSwitcher
        aria-label={t("appearance.label")}
        labels={{
          color: { name: t("appearance.color"), description: t("appearance.colorHint") },
          light: { name: t("appearance.light"), description: t("appearance.lightHint") },
          dark: { name: t("appearance.dark"), description: t("appearance.darkHint") },
          system: { name: t("appearance.system"), description: t("appearance.systemHint") },
        }}
      />
    </SettingsSection>
  );
}
