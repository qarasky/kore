import { t } from "@/lib/i18n";

/** Shown over an empty listing (below the column header). */
export function EmptyState({ sharedRoot }: { sharedRoot: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-8 bottom-0 flex flex-col items-center justify-center gap-1 px-6 text-center">
      <p className="text-[14px] font-medium">{sharedRoot ? t("empty.sharedTitle") : t("empty.folderTitle")}</p>
      <p className="max-w-[360px] text-muted">{sharedRoot ? t("empty.shared") : t("empty.folder")}</p>
    </div>
  );
}
