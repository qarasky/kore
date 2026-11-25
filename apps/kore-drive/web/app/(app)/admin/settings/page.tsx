import { LoginImageCard } from "@/components/admin/LoginImageCard";
import { SettingsForm } from "@/components/admin/SettingsForm";
import type { AdminSettings } from "@/lib/admin";
import { api } from "@/lib/api";
import type { Branding } from "@/lib/branding";
import { t } from "@/lib/i18n";
import { requireAdmin } from "@/lib/session";

export const metadata = { title: t("settings.title") };

/** `/admin/settings`: instance settings stored in the database. */
export default async function AdminSettingsPage() {
  await requireAdmin();
  const [settings, branding] = await Promise.all([
    api<AdminSettings>("/api/admin/settings"),
    api<Branding>("/api/branding").catch(() => null),
  ]);
  return (
    <>
      <SettingsForm settings={settings} />
      <LoginImageCard initial={branding} />
    </>
  );
}
