import { SettingsForm } from "@/components/admin/SettingsForm";
import type { AdminSettings } from "@/lib/admin";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { requireAdmin } from "@/lib/session";

export const metadata = { title: t("settings.title") };

/** `/admin/settings`: instance settings stored in the database. */
export default async function AdminSettingsPage() {
  await requireAdmin();
  const settings = await api<AdminSettings>("/api/admin/settings");
  return <SettingsForm settings={settings} />;
}
