import { notFound } from "next/navigation";
import { UsersManager } from "@/components/settings/UsersManager";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import type { AdminUser } from "@/lib/types";

export const metadata = { title: t("settings.users") };

export default async function UsersSettingsPage() {
  // The admin area does not reveal itself to anyone else (the API refuses them too).
  const me = await requireUser();
  if (me.role !== "admin") notFound();
  const users = await api<AdminUser[]>("/api/admin/users");
  return <UsersManager initial={users} />;
}
