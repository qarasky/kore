import Link from "next/link";
import { t } from "@/lib/i18n";
import { buttonClass } from "./Button";

/** Shown instead of the calendar when there is no calendar to put events in. */
export function NoCalendars() {
  return (
    <div className="grid h-full place-items-center p-6 text-center" data-testid="no-calendars">
      <div>
        <h2 className="text-title font-semibold">{t("empty.noCalendarsTitle")}</h2>
        <p className="mt-2 text-sub text-muted">{t("empty.noCalendarsBody")}</p>
        <Link href="/settings/calendars" className={`${buttonClass("primary")} mt-4`}>
          {t("empty.noCalendarsAction")}
        </Link>
      </div>
    </div>
  );
}
