"use client";

import { calendarTint } from "@/lib/colors";
import { formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { utcToLocal } from "@/lib/tz";
import type { Clock, Occurrence } from "@/lib/types";
import { RepeatIcon } from "./icons";

/** A one-line event for month cells: all-day events are filled bars, timed
 *  ones a coloured dot, the start time and the title. */
export function EventChip({
  occ,
  day,
  color,
  tz,
  clock,
  onOpen,
}: {
  occ: Occurrence;
  /** The cell's day, to tell where a multi-day event starts. */
  day: string;
  color: string;
  tz: string;
  clock: Clock;
  onOpen: (el: HTMLElement) => void;
}) {
  const tint = calendarTint(color);
  const title = occ.title || t("grid.untitled");
  const start = occ.all_day ? null : utcToLocal(new Date(occ.start_utc), tz);
  const time = start && start.day === day ? formatTime(start.minutes, clock) : null;
  return (
    <button
      type="button"
      data-testid="event"
      data-event-id={occ.event_id}
      data-key={occ.key}
      data-title={occ.title}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(e.currentTarget);
      }}
      className={
        "flex min-h-5 w-full min-w-0 items-center gap-1 rounded-[4px] px-1 text-left text-2xs hover:brightness-125 " +
        (occ.all_day ? "font-medium text-text" : "hover:bg-raised")
      }
      style={occ.all_day ? { backgroundColor: tint.bg, boxShadow: `inset 3px 0 0 ${tint.edge}`, paddingLeft: "0.5rem" } : undefined}
    >
      {occ.all_day ? null : <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: tint.edge }} />}
      {time ? <span className="shrink-0 text-muted">{time}</span> : null}
      <span className="min-w-0 truncate">{title}</span>
      {occ.is_recurring ? <RepeatIcon size={11} className="shrink-0 text-muted" aria-label={t("grid.repeats")} /> : null}
    </button>
  );
}
