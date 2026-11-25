import { Button, EmptyState } from "@qarasky/kore-ui";
import { CalendarPlus } from "lucide-react";
import Link from "next/link";
import { t } from "@/lib/i18n";

/** Shown instead of the calendar when there is no calendar to put events in. */
export function NoCalendars() {
  return (
    <EmptyState
      className="h-full"
      icon={<CalendarPlus />}
      title={<span role="heading" aria-level={2}>{t("empty.noCalendarsTitle")}</span>}
      description={t("empty.noCalendarsBody")}
      action={
        <Button asChild variant="primary">
          <Link href="/settings/calendars">{t("empty.noCalendarsAction")}</Link>
        </Button>
      }
    />
  );
}
