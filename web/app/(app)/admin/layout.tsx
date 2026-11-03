import { PageHeader } from "@qarasky/kore-ui";
import { AdminNav } from "@/components/admin/AdminNav";
import { t } from "@/lib/i18n";
import { requireAdmin } from "@/lib/session";

/** Admin area shell (admins only; everyone else gets the 404 page). Every
 *  page repeats the check, since a layout and its page render independently. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t("admin.title")} tabs={<AdminNav />} />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
