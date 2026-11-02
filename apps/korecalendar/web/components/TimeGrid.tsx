"use client";

import { useEffect, useMemo, useRef } from "react";
import { placedId, useGridDrag } from "@/hooks/useGridDrag";
import { useMoveCommit } from "@/hooks/useMoveCommit";
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
 *  tinted events with overlaps laid side by side, a now-line, and dragging:
 *  empty space creates, an event moves, its bottom edge resizes. */
export function TimeGrid({ days, occurrences }: { days: string[]; occurrences: Occurrence[] }) {
  const { me, prefs, calendars, today } = useShell();
  const { openNew, openOccurrence } = useEditor();
  const tz = me.timezone;
  const scroller = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const mover = useMoveCommit();

  const placed = useMemo(() => placeTimed(occurrences, days, tz), [occurrences, days, tz]);
  const allDay = useMemo(() => placeAllDay(occurrences, days), [occurrences, days]);
  const colors = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars]);
  const colorOf = (id: string) => colors.get(id) ?? "#5b8def";
  const todayInGrid = days.includes(today);

  const drag = useGridDrag({
    days,
    areaRef: area,
    onCreate: (r) => openNew({ day: r.day, minutes: r.startMinutes, durationMinutes: r.endMinutes - r.startMinutes }),
    onMove: (p, move) => void mover.commit(p.occ, move),
    onResize: (p, duration) => void mover.commit(p.occ, { deltaDays: 0, deltaMinutes: 0, newDurationMinutes: duration }),
  });
  const { dropped, settle } = drag;
  // A dropped block stays where it landed until the refreshed data is on screen.
  useEffect(() => {
    if (dropped && !mover.busy) settle();
  }, [dropped, mover.busy, settle]);

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

  const ghost = drag.ghost;

  return (
    <div ref={scroller} className="h-full overflow-y-auto" data-testid="time-grid" onClickCapture={drag.swallowClick}>
      <div className="sticky top-0 z-30 bg-surface">
        <div className="grid" style={{ gridTemplateColumns: `var(--gutter) repeat(${days.length}, minmax(0, 1fr))` }}>
          <div />
          {days.map((d) => (
            <DayHeader key={d} day={d} today={today} />
          ))}
        </div>
        <AllDayRow placed={allDay} columns={days.length} colorOf={colorOf} onOpen={(p, el) => openOccurrence(p.occ, el)} />
        <div className="border-b border-border" />
      </div>
      <div className="relative flex" style={{ height: "calc(var(--hour) * 24)" }}>
        <div className="relative shrink-0" style={{ width: "var(--gutter)" }} aria-hidden="true">
          {HOURS.slice(1).map((h) => (
            <span key={h} className="absolute right-2 -translate-y-1/2 text-2xs text-muted" style={{ top: `calc(var(--hour) * ${h})` }}>
              {hourLabel(h, prefs.clock)}
            </span>
          ))}
        </div>
        <div ref={area} className="relative grid min-w-0 flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((d, i) => {
            const dayPlaced = placed.filter((p) => p.day === d);
            return (
              <div
                key={d}
                data-testid="day-column"
                data-day={d}
                className="relative border-l border-border"
                style={{ backgroundImage: LINES }}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) drag.startCreate(e);
                }}
                onClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  openNew({ day: d, minutes: snapForClick(e.clientY - rect.top, rect.height), durationMinutes: 60 });
                }}
              >
                {dayPlaced.map((p) => {
                  const id = placedId(p);
                  const moving = ghost && ghost.kind !== "create" && ghost.id === id;
                  return (
                    <EventBlock
                      key={id}
                      placed={p}
                      color={colorOf(p.occ.calendar_id)}
                      tz={tz}
                      clock={prefs.clock}
                      state={moving ? "source" : "normal"}
                      onOpen={(el) => openOccurrence(p.occ, el)}
                      onPointerDown={(e) => drag.startMove(e, p)}
                      onKeyDown={(e) => drag.keyboard(e, p)}
                      onResizeStart={p.continuesBefore || p.continuesAfter ? undefined : (e) => drag.startResize(e, p)}
                    />
                  );
                })}
                {ghost?.kind === "create" && ghost.dayIndex === i ? (
                  <div
                    data-testid="create-ghost"
                    className="pointer-events-none absolute right-1 left-0.5 z-30 rounded-[4px] border border-accent bg-accent/25"
                    style={{ top: `calc(var(--hour) * ${ghost.startMin / 60})`, height: `calc(var(--hour) * ${(ghost.endMin - ghost.startMin) / 60})` }}
                  />
                ) : null}
                {ghost && ghost.kind !== "create" && ghost.dayIndex === i
                  ? placed
                      .filter((p) => placedId(p) === ghost.id)
                      .slice(0, 1)
                      .map((p) => (
                        <EventBlock
                          key="ghost"
                          placed={{ ...p, top: ghost.top, height: ghost.height, col: 0, cols: 1, span: 1, continuesBefore: false, continuesAfter: false }}
                          color={colorOf(p.occ.calendar_id)}
                          tz={tz}
                          clock={prefs.clock}
                          state="ghost"
                          onOpen={() => {}}
                        />
                      ))
                  : null}
                <NowLine day={d} tz={tz} />
              </div>
            );
          })}
        </div>
      </div>
      {mover.dialog}
    </div>
  );
}
