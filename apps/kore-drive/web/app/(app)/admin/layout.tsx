import { AdminNav } from "@/components/admin/AdminNav";
import { t } from "@/lib/i18n";
import { requireAdmin } from "@/lib/session";

/** Admin area shell (admins only; everyone else gets the 404 page). Every
 *  page repeats the check, since a layout and its page render independently. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-4 border-b border-border px-4">
        <h1 className="text-[14px] font-semibold">{t("admin.title")}</h1>
        <AdminNav />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
