import Link from "next/link";
import { TrashList } from "@/components/TrashList";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { Space } from "@/lib/nodes";
import { requireUser } from "@/lib/session";
import { trashHref, trashSpace, type TrashedNode } from "@/lib/trash";

export const metadata = { title: t("trash.title") };

const TABS: { space: Space; label: () => string }[] = [
  { space: "personal", label: () => t("trash.mine") },
  { space: "shared", label: () => t("trash.shared") },
];

/** `/trash` (My trash) and `/trash?space=shared` (Shared trash). */
export default async function TrashPage({ searchParams }: PageProps<"/trash">) {
  await requireUser();
  const space = trashSpace((await searchParams).space);
  const [items, settings] = await Promise.all([
    api<TrashedNode[]>(`/api/trash?space=${space}`),
    // Only a note: without it the page still works.
    api<{ trash_retention_days: number }>("/api/me/settings").catch(() => null),
  ]);
  const days = settings?.trash_retention_days;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-4 border-b border-border px-4">
        <h1 className="text-[14px] font-semibold">{t("trash.title")}</h1>
        <nav aria-label={t("trash.tabs")} className="flex items-center gap-1">
          {TABS.map((tab) => {
            const active = tab.space === space;
            return (
              <Link
                key={tab.space}
                href={trashHref(tab.space)}
                aria-current={active ? "page" : undefined}
                className={
                  "rounded-ui px-2.5 py-1 transition-colors " +
                  (active ? "bg-raised font-medium text-text" : "text-muted hover:bg-white/[0.04] hover:text-text")
                }
              >
                {tab.label()}
              </Link>
            );
          })}
        </nav>
        {typeof days === "number" && (
          <p data-testid="trash-retention" className="ml-auto truncate text-[12px] text-muted">
            {days === 1 ? t("trash.retentionOne") : t("trash.retention", { days })}
          </p>
        )}
      </div>
      <TrashList key={space} space={space} items={items} />
    </div>
  );
}
