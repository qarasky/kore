import { UsersTable } from "@/components/admin/UsersTable";
import type { AdminSettings, AdminUser } from "@/lib/admin";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { requireAdmin } from "@/lib/session";

export const metadata = { title: t("admin.users.title") };

/** `/admin/users`: every account with its usage; add, edit, reset, delete. */
export default async function AdminUsersPage() {
  const me = await requireAdmin();
  const [users, settings] = await Promise.all([
    api<AdminUser[]>("/api/admin/users"),
    api<AdminSettings>("/api/admin/settings"),
  ]);
  return <UsersTable users={users} meId={me.id} defaultQuota={settings.default_quota_bytes} />;
}
