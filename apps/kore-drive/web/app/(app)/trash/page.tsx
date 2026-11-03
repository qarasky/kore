import { NavTabs, PageHeader } from "@qarasky/kore-ui";
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
      <PageHeader
        title={t("trash.title")}
        tabs={
          <NavTabs
            label={t("trash.tabs")}
            items={TABS.map((tab) => ({ href: trashHref(tab.space), label: tab.label(), active: tab.space === space }))}
          />
        }
        actions={
          typeof days === "number" ? (
            <p data-testid="trash-retention" className="truncate text-meta text-muted max-md:hidden">
              {days === 1 ? t("trash.retentionOne") : t("trash.retention", { days })}
            </p>
          ) : undefined
        }
      />
      <TrashList key={space} space={space} items={items} />
    </div>
  );
}
