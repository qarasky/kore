import { Skeleton } from "@qarasky/kore-ui";
import { t } from "@/lib/i18n";

/** Shown while a view's events are fetched: the grid's skeleton, so the page doesn't jump. */
export default function Loading() {
  return (
    <div role="status" aria-label={t("loading.calendar")} className="flex h-full flex-col" data-testid="calendar-loading">
      <div className="flex gap-2 border-b border-border p-3">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-8 flex-1" />
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 gap-px p-2">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="opacity-60" />
        ))}
      </div>
    </div>
  );
}
