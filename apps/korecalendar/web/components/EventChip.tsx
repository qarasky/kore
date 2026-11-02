"use client";

import { m } from "motion/react";
import { calendarTint } from "@/lib/colors";
import { formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { duration, ease, layoutKey, spring } from "@/lib/motion";
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
  onPointerDown,
  dragging = false,
  shared = true,
  enterDelay = 0,
}: {
  occ: Occurrence;
  /** The cell's day, to tell where a multi-day event starts. */
  day: string;
  color: string;
  tz: string;
  clock: Clock;
  onOpen: (el: HTMLElement) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  dragging?: boolean;
  /** Glides between cells with the same event. Off for the "+N more" list, whose chips duplicate the cells'. */
  shared?: boolean;
  /** Seconds before it appears: a short stagger for a list that opens all at once. */
  enterDelay?: number;
}) {
  const tint = calendarTint(color);
  const title = occ.title || t("grid.untitled");
  const start = occ.all_day ? null : utcToLocal(new Date(occ.start_utc), tz);
  const time = start && start.day === day ? formatTime(start.minutes, clock) : null;
  return (
    <m.button
      type="button"
      layout={shared ? "position" : false}
      layoutId={shared ? layoutKey(occ) : undefined}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: dragging ? 0.4 : 1, scale: 1, transition: { duration: duration.enter, ease: ease.standard, delay: enterDelay } }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: duration.exit, ease: ease.exit } }}
      transition={{ layout: spring.settle }}
      data-testid="event"
      data-event-id={occ.event_id}
      data-key={occ.key}
      data-title={occ.title}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(e.currentTarget);
      }}
      onPointerDown={onPointerDown}
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
    </m.button>
  );
}
