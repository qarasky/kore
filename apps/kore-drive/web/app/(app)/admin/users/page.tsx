import { UsersTable } from "@/components/admin/UsersTable";
import type { AdminUser } from "@/lib/admin";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { requireAdmin } from "@/lib/session";

export const metadata = { title: t("admin.users.title") };

/** `/admin/users`: every account with its usage; edit role/quota or delete.
 *  Accounts themselves come from Kore ID on first sign-in. */
export default async function AdminUsersPage() {
  const me = await requireAdmin();
  const users = await api<AdminUser[]>("/api/admin/users");
  return <UsersTable users={users} meId={me.id} />;
}
