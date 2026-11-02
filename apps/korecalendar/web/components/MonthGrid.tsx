"use client";

import Link from "next/link";
import { AnimatePresence, m } from "motion/react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { COMPACT_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { useMonthDrag } from "@/hooks/useMonthDrag";
import { useMoveCommit } from "@/hooks/useMoveCommit";
import { chipsForDay, groupByDay } from "@/lib/agenda";
import { isSameMonth, parseDay, weekday } from "@/lib/dates";
import { monthShortName, weekdayShort } from "@/lib/format";
import { t } from "@/lib/i18n";
import { calendarHref } from "@/lib/range";
import type { Occurrence } from "@/lib/types";
import { useEditor } from "./EditorContext";
import { EventChip } from "./EventChip";
import { MoreEvents } from "./MoreEvents";
import { useShell } from "./ShellContext";

const MAX_CHIPS = 3;

/** Six weeks as a grid of days; each cell lists up to three events and a
 *  "+N more" that opens the rest. Clicking an empty cell starts a new event. */
export function MonthGrid({ day, days, occurrences }: { day: string; days: string[]; occurrences: Occurrence[] }) {
  const { me, prefs, calendars, today } = useShell();
  const { openNew, openOccurrence } = useEditor();
  const tz = me.timezone;
  const router = useRouter();
  const compact = useMediaQuery(COMPACT_QUERY);
  const mover = useMoveCommit();
  const drag = useMonthDrag((occ, deltaDays) => void mover.commit(occ, { deltaDays, deltaMinutes: 0 }));
  const groups = useMemo(() => groupByDay(occurrences, days, tz), [occurrences, days, tz]);
  const colors = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars]);
  const colorOf = (id: string) => colors.get(id) ?? "#5b8def";

  return (
    <div className="flex h-full min-h-[34rem] flex-col" data-testid="month-grid" onClickCapture={drag.swallowClick}>
      <div role="row" aria-label={t("month.weekdays")} className="grid grid-cols-7 border-b border-border">
        {days.slice(0, 7).map((d) => (
          <div key={d} role="columnheader" className="py-2 text-center text-meta text-muted">
            {weekdayShort(weekday(d))}
          </div>
        ))}
      </div>
      <m.div layoutScroll className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 overflow-y-auto">
        {groups.map(({ day: d, items }, i) => {
          const { shown, more } = chipsForDay(items, MAX_CHIPS);
          const isToday = d === today;
          const { day: dom, month } = parseDay(d);
          return (
            <div
              key={d}
              data-testid="month-cell"
              data-day={d}
              className={`flex min-h-[5.5rem] min-w-0 cursor-default flex-col gap-0.5 border-t border-l border-border p-1 ${isSameMonth(d, day) ? "" : "bg-bg/30"} ${drag.over === d ? "bg-accent/15 ring-1 ring-accent ring-inset" : ""}`}
              onClick={() => (compact ? router.push(calendarHref("day", d)) : openNew({ day: d, minutes: 9 * 60, durationMinutes: 60 }))}
            >
              <Link
                href={calendarHref("day", d)}
                aria-current={isToday ? "date" : undefined}
                onClick={(e) => e.stopPropagation()}
                className={
                  "mb-0.5 inline-flex h-6 min-w-6 items-center justify-center self-start rounded-full px-1.5 text-meta " +
                  (isToday ? "bg-accent font-semibold text-white" : isSameMonth(d, day) ? "text-text hover:bg-raised" : "text-muted hover:bg-raised")
                }
              >
                {dom === 1 ? `${dom} ${monthShortName(month - 1)}` : dom}
              </Link>
              {compact ? (
                <div className="flex flex-wrap gap-0.5" aria-label={t("month.openDay", { date: d })}>
                  {items.slice(0, 6).map((occ) => (
                    <span key={occ.event_id + occ.key} data-testid="month-dot" className="size-1.5 rounded-full" style={{ background: colorOf(occ.calendar_id) }} />
                  ))}
                </div>
              ) : null}
              <AnimatePresence initial={false}>
              {(compact ? [] : shown).map((occ) => (
                <EventChip
                  key={occ.event_id + occ.key}
                  occ={occ}
                  day={d}
                  color={colorOf(occ.calendar_id)}
                  tz={tz}
                  clock={prefs.clock}
                  onOpen={(el) => openOccurrence(occ, el)}
                  onPointerDown={(e) => drag.start(e, occ, d)}
                  dragging={drag.dragging === occ.event_id + occ.key}
                />
              ))}
              </AnimatePresence>
              {!compact && more > 0 ? (
                <MoreEvents
                  count={more}
                  day={d}
                  items={items}
                  colorOf={colorOf}
                  tz={tz}
                  clock={prefs.clock}
                  alignRight={i % 7 >= 5}
                  onOpen={(o, el) => openOccurrence(o, el)}
                />
              ) : null}
            </div>
          );
        })}
      </m.div>
      {mover.dialog}
    </div>
  );
}
