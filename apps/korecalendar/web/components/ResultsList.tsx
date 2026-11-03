"use client";

import Link from "next/link";
import { useMemo } from "react";
import { groupByStartDay } from "@/lib/agenda";
import { calendarTint } from "@/lib/colors";
import { parseDay } from "@/lib/dates";
import { formatDayShort, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { calendarHref } from "@/lib/range";
import { utcToLocal } from "@/lib/tz";
import type { Occurrence } from "@/lib/types";
import { RepeatIcon } from "lucide-react";
import { useShell } from "./ShellContext";

/** Search hits grouped by day; each row opens that day. */
export function ResultsList({ occurrences }: { occurrences: Occurrence[] }) {
  const { me, prefs, calendars } = useShell();
  const tz = me.timezone;
  const groups = useMemo(() => groupByStartDay(occurrences, tz), [occurrences, tz]);
  const colors = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars]);
  return (
    <div data-testid="search-results">
      {groups.map(({ day, items }) => (
        <section key={day} aria-label={formatDayShort(day)} className="border-b border-border px-4 py-3">
          <h2 className="mb-1.5 text-sub font-semibold">
            {formatDayShort(day)} {parseDay(day).year}
          </h2>
          <ul>
            {items.map((occ) => {
              const tint = calendarTint(colors.get(occ.calendar_id) ?? "#5b8def");
              const time = occ.all_day ? t("agenda.allDay") : formatTime(utcToLocal(new Date(occ.start_utc), tz).minutes, prefs.clock);
              return (
                <li key={occ.event_id + occ.key}>
                  <Link
                    href={calendarHref("day", day)}
                    data-testid="result"
                    className="flex min-h-control items-center gap-3 rounded-ui px-2 hover:bg-white/5"
                  >
                    <span aria-hidden="true" className="h-5 w-1 shrink-0 rounded-full" style={{ backgroundColor: tint.edge }} />
                    <span className="w-24 shrink-0 text-sub text-muted tabular-nums">{time}</span>
                    <span className="min-w-0 flex-1 truncate text-sub">{occ.title || t("grid.untitled")}</span>
                    {occ.location ? <span className="hidden max-w-48 truncate text-meta text-muted sm:block">{occ.location}</span> : null}
                    {occ.is_recurring ? <RepeatIcon size={14} className="shrink-0 text-muted" aria-label={t("grid.repeats")} /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
