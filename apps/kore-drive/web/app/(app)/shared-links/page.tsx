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
      <div className="flex h-14 shrink-0 items-center gap-4 border-b border-border px-4">
        <h1 className="text-heading font-semibold">{t("sharedLinks.title")}</h1>
        <p className="ml-auto truncate text-meta text-muted">{t("sharedLinks.hint")}</p>
      </div>
      <SharedLinksList shares={shares} />
    </div>
  );
}
