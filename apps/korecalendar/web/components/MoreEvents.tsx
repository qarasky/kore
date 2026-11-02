"use client";

import { useEffect, useRef, useState } from "react";
import { formatDayShort } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Clock, Occurrence } from "@/lib/types";
import { EventChip } from "./EventChip";

/** "+N more" in a month cell: opens a small list of that whole day's events. */
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
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={t("month.moreLabel", { count, date: formatDayShort(day) })}
        aria-expanded={open}
        data-testid="more-events"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="min-h-5 w-full rounded-[4px] px-1 text-left text-2xs font-medium text-muted hover:bg-raised hover:text-text"
      >
        {t("month.more", { count })}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={formatDayShort(day)}
          className={`absolute top-0 z-40 w-60 rounded-ui border border-border-strong bg-raised p-2 shadow-xl shadow-black/40 ${alignRight ? "right-0" : "left-0"}`}
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="mb-1.5 px-1 text-meta font-semibold">{formatDayShort(day)}</h3>
          <div className="flex flex-col gap-0.5">
            {items.map((occ) => (
              <EventChip
                key={occ.event_id + occ.key}
                occ={occ}
                day={day}
                color={colorOf(occ.calendar_id)}
                tz={tz}
                clock={clock}
                onOpen={(el) => {
                  setOpen(false);
                  onOpen(occ, el);
                }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
