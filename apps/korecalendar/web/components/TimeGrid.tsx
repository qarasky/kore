"use client";

import { useEffect, useMemo, useRef } from "react";
import { snapForClick } from "@/lib/click";
import { hourLabel } from "@/lib/format";
import { placeAllDay, placeTimed } from "@/lib/layout";
import { utcToLocal } from "@/lib/tz";
import type { Occurrence } from "@/lib/types";
import { AllDayRow } from "./AllDayRow";
import { DayHeader } from "./DayHeader";
import { useEditor } from "./EditorContext";
import { EventBlock } from "./EventBlock";
import { NowLine } from "./NowLine";
import { useShell } from "./ShellContext";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const LINES =
  "repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--hour) - 1px), var(--color-border) calc(var(--hour) - 1px), var(--color-border) var(--hour))";

/** The Day and Week views: hour gutter, one column per day, an all-day strip,
 *  tinted events with overlaps laid side by side, and a now-line. */
export function TimeGrid({ days, occurrences }: { days: string[]; occurrences: Occurrence[] }) {
  const { me, prefs, calendars, today } = useShell();
  const { openNew, openOccurrence } = useEditor();
  const tz = me.timezone;
  const scroller = useRef<HTMLDivElement>(null);

  const placed = useMemo(() => placeTimed(occurrences, days, tz), [occurrences, days, tz]);
  const allDay = useMemo(() => placeAllDay(occurrences, days), [occurrences, days]);
  const colors = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars]);
  const colorOf = (id: string) => colors.get(id) ?? "#5b8def";
  const todayInGrid = days.includes(today);

  // Open near the start of the working day, or an hour and a half above the now-line.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const hour = parseFloat(getComputedStyle(el).getPropertyValue("--hour")) || 3.25;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 15;
    const nowMinutes = todayInGrid ? utcToLocal(new Date(), tz).minutes : null;
    const focus = nowMinutes === null ? 7 * 60 : Math.max(0, nowMinutes - 90);
    el.scrollTop = (focus / 60) * hour * rem;
  }, [days, tz, todayInGrid]);

  return (
    <div ref={scroller} className="h-full overflow-y-auto" data-testid="time-grid">
      <div className="sticky top-0 z-30 bg-surface">
        <div className="grid" style={{ gridTemplateColumns: `var(--gutter) repeat(${days.length}, minmax(0, 1fr))` }}>
          <div />
          {days.map((d) => (
            <DayHeader key={d} day={d} today={today} />
          ))}
        </div>
        <AllDayRow
          placed={allDay}
          columns={days.length}
          colorOf={colorOf}
          onOpen={(p, el) => openOccurrence(p.occ, el)}
        />
        <div className="border-b border-border" />
      </div>
      <div className="relative grid" style={{ gridTemplateColumns: `var(--gutter) repeat(${days.length}, minmax(0, 1fr))`, height: "calc(var(--hour) * 24)" }}>
        <div className="relative" aria-hidden="true">
          {HOURS.slice(1).map((h) => (
            <span key={h} className="absolute right-2 -translate-y-1/2 text-2xs text-muted" style={{ top: `calc(var(--hour) * ${h})` }}>
              {hourLabel(h, prefs.clock)}
            </span>
          ))}
        </div>
        {days.map((d) => (
          <div
            key={d}
            data-testid="day-column"
            data-day={d}
            className="relative border-l border-border"
            style={{ backgroundImage: LINES }}
            onClick={(e) => {
              if (e.target !== e.currentTarget) return;
              const rect = e.currentTarget.getBoundingClientRect();
              openNew({ day: d, minutes: snapForClick(e.clientY - rect.top, rect.height), durationMinutes: 60 });
            }}
          >
            {placed
              .filter((p) => p.day === d)
              .map((p) => (
                <EventBlock
                  key={p.occ.event_id + p.occ.key + p.day}
                  placed={p}
                  color={colorOf(p.occ.calendar_id)}
                  tz={tz}
                  clock={prefs.clock}
                  onOpen={(el) => openOccurrence(p.occ, el)}
                />
              ))}
            <NowLine day={d} tz={tz} />
          </div>
        ))}
      </div>
    </div>
  );
}
