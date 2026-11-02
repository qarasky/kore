import { CalendarsManager } from "@/components/settings/CalendarsManager";
import { t } from "@/lib/i18n";

export const metadata = { title: t("settings.calendars") };

export default function CalendarsSettingsPage() {
  return <CalendarsManager />;
}
