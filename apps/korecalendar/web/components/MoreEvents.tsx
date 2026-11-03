"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@qarasky/kore-ui";
import { useRef, useState } from "react";
import { formatDayShort } from "@/lib/format";
import { t } from "@/lib/i18n";
import { staggerDelay } from "@/lib/motion";
import type { Clock, Occurrence } from "@/lib/types";
import { EventChip } from "./EventChip";

/** "+N more" in a month cell: a kore-ui Popover listing that whole day's events. */
export function MoreEvents({
  count,
  day,
  items,
  colorOf,
  tz,
  clock,
  alignRight,
  onOpen,
}: {
  count: number;
  day: string;
  items: Occurrence[];
  colorOf: (calendarId: string) => string;
  tz: string;
  clock: Clock;
  alignRight: boolean;
  onOpen: (occ: Occurrence, el: HTMLElement) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={trigger}
          type="button"
          aria-label={t("month.moreLabel", { count, date: formatDayShort(day) })}
          data-testid="more-events"
          onClick={(e) => e.stopPropagation()}
          className="min-h-5 w-full rounded-[4px] px-1 text-left text-2xs font-medium text-muted hover:bg-white/5 hover:text-text"
        >
          {t("month.more", { count })}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align={alignRight ? "end" : "start"}
        sideOffset={-20}
        aria-label={formatDayShort(day)}
        className="w-60 p-2"
        // Portalled, but React events still bubble to the month cell (which would start a new event).
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1.5 px-1 text-meta font-semibold">{formatDayShort(day)}</h3>
        <div className="flex flex-col gap-0.5">
          {items.map((occ, i) => (
            <EventChip
              key={occ.event_id + occ.key}
              shared={false}
              enterDelay={staggerDelay(i, items.length)}
              occ={occ}
              day={day}
              color={colorOf(occ.calendar_id)}
              tz={tz}
              clock={clock}
              onOpen={(el) => {
                setOpen(false);
                // The chip leaves with this list; anchor the event's popover on "+N more", which stays.
                onOpen(occ, trigger.current ?? el);
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
