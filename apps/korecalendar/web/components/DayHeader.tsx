"use client";

import Link from "next/link";
import { parseDay } from "@/lib/dates";
import { formatDayShort, weekdayShort } from "@/lib/format";
import { t } from "@/lib/i18n";
import { calendarHref } from "@/lib/range";
import { weekday } from "@/lib/dates";

/** One day's heading: the weekday and the date number (a filled circle for
 *  today). It links to that day's Day view. */
export function DayHeader({ day, today }: { day: string; today: string }) {
  const isToday = day === today;
  return (
    <Link
      href={calendarHref("day", day)}
      aria-label={t("grid.goToDay", { date: formatDayShort(day) })}
      aria-current={isToday ? "date" : undefined}
      className="flex flex-col items-center gap-0.5 border-l border-border py-1.5 text-meta hover:bg-white/[0.04]"
    >
      <span className={isToday ? "text-accent" : "text-muted"}>{weekdayShort(weekday(day))}</span>
      <span
        className={
          "grid size-8 place-items-center rounded-full text-heading font-medium " + (isToday ? "bg-accent text-white" : "text-text")
        }
      >
        {parseDay(day).day}
      </span>
    </Link>
  );
}
