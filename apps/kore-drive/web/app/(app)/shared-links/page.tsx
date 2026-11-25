import { PageHeader } from "@qarasky/kore-ui";
import { SharedLinksList } from "@/components/SharedLinksList";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import type { Share } from "@/lib/shares";

export const metadata = { title: t("sharedLinks.title") };

/** `/shared-links`: the caller's public links (only their own). */
export default async function SharedLinksPage() {
  await requireUser();
  const shares = await api<Share[]>("/api/shares");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={t("sharedLinks.title")}
        actions={<p className="truncate text-meta text-muted max-md:hidden">{t("sharedLinks.hint")}</p>}
      />
      <SharedLinksList shares={shares} />
    </div>
  );
}
