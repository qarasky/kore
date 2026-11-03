"use client";

import { useMemo } from "react";
import { groupByDay } from "@/lib/agenda";
import { calendarTint } from "@/lib/colors";
import { parseDay } from "@/lib/dates";
import { formatDayShort, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { utcToLocal } from "@/lib/tz";
import type { Clock, Occurrence } from "@/lib/types";
import { useEditor } from "./EditorContext";
import { RepeatIcon } from "lucide-react";
import { useShell } from "./ShellContext";

/** When an occurrence is on `day`: "All day", "16:00 – 17:00", "continues"… */
function whenOn(occ: Occurrence, day: string, tz: string, clock: Clock): string {
  if (occ.all_day) return t("agenda.allDay");
  const s = utcToLocal(new Date(occ.start_utc), tz);
  const e = utcToLocal(new Date(occ.end_utc), tz);
  if (s.day === day && e.day === day) return `${formatTime(s.minutes, clock)} – ${formatTime(e.minutes, clock)}`;
  if (s.day === day) return formatTime(s.minutes, clock);
  if (e.day === day) return t("agenda.until", { time: formatTime(e.minutes, clock) });
  return t("agenda.continues");
}

/** The next 30 days as a list: a heading per day that has events. */
export function AgendaList({ days, occurrences }: { days: string[]; occurrences: Occurrence[] }) {
  const { me, prefs, calendars, today } = useShell();
  const { openOccurrence } = useEditor();
  const tz = me.timezone;
  const groups = useMemo(() => groupByDay(occurrences, days, tz).filter((g) => g.items.length > 0), [occurrences, days, tz]);
  const colors = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars]);

  if (groups.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6 text-sub text-muted" data-testid="agenda-empty">
        {t("agenda.empty")}
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto" data-testid="agenda">
      {groups.map(({ day, items }) => (
        <section key={day} aria-label={formatDayShort(day)} className="border-b border-border px-4 py-3">
          <h2 className="mb-1.5 flex items-baseline gap-2 text-sub font-semibold">
            {formatDayShort(day)} {parseDay(day).year}
            {day === today ? <span className="rounded-full bg-accent px-2 py-0.5 text-2xs font-medium text-white">{t("agenda.today")}</span> : null}
          </h2>
          <ul className="flex flex-col">
            {items.map((occ) => {
              const tint = calendarTint(colors.get(occ.calendar_id) ?? "#5b8def");
              return (
                <li key={occ.event_id + occ.key}>
                  <button
                    type="button"
                    data-testid="event"
                    data-event-id={occ.event_id}
                    data-key={occ.key}
                    data-title={occ.title}
                    onClick={(e) => openOccurrence(occ, e.currentTarget)}
                    className="flex min-h-control w-full items-center gap-3 rounded-ui px-2 text-left hover:bg-white/5"
                  >
                    <span aria-hidden="true" className="h-5 w-1 shrink-0 rounded-full" style={{ backgroundColor: tint.edge }} />
                    <span className="w-32 shrink-0 text-sub text-muted tabular-nums">{whenOn(occ, day, tz, prefs.clock)}</span>
                    <span className="min-w-0 flex-1 truncate text-sub">{occ.title || t("grid.untitled")}</span>
                    {occ.location ? <span className="hidden max-w-48 truncate text-meta text-muted sm:block">{occ.location}</span> : null}
                    {occ.is_recurring ? <RepeatIcon size={14} className="shrink-0 text-muted" aria-label={t("grid.repeats")} /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
