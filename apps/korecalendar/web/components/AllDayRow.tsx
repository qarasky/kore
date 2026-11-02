"use client";

import { calendarTint } from "@/lib/colors";
import { AnimatePresence, m } from "motion/react";
import { t } from "@/lib/i18n";
import { duration, ease, layoutKey } from "@/lib/motion";
import type { AllDayPlaced } from "@/lib/layout";
import { RepeatIcon } from "./icons";

/** The strip above the grid for all-day events: bars spanning their days. */
export function AllDayRow({
  placed,
  columns,
  colorOf,
  onOpen,
}: {
  placed: AllDayPlaced[];
  columns: number;
  colorOf: (calendarId: string) => string;
  onOpen: (p: AllDayPlaced, el: HTMLElement) => void;
}) {
  if (placed.length === 0) return null;
  return (
    <div
      className="grid border-b border-border py-1"
      style={{ gridTemplateColumns: `var(--gutter) repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: "1.5rem" }}
    >
      <span className="pr-2 text-right text-2xs text-muted" style={{ gridColumn: 1, gridRow: 1 }}>
        {t("grid.allDay")}
      </span>
      <AnimatePresence initial={false}>
      {placed.map((p) => {
        const tint = calendarTint(colorOf(p.occ.calendar_id));
        return (
          <m.button
            key={p.occ.event_id + p.occ.key}
            layoutId={`allday|${layoutKey(p.occ)}`}
            layout="position"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: duration.enter, ease: ease.standard } }}
            exit={{ opacity: 0, transition: { duration: duration.exit, ease: ease.exit } }}
            type="button"
            data-testid="event"
            data-all-day="true"
            data-event-id={p.occ.event_id}
            data-key={p.occ.key}
            data-title={p.occ.title}
            aria-label={p.occ.title}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(p, e.currentTarget);
            }}
            className={
              "mx-px flex min-w-0 items-center gap-1 overflow-hidden border-l-[3px] px-1.5 text-left text-2xs font-medium text-text hover:brightness-125 " +
              (p.clippedBefore ? "rounded-l-none " : "rounded-l-[4px] ") +
              (p.clippedAfter ? "rounded-r-none" : "rounded-r-[4px]")
            }
            style={{ gridColumn: `${p.startIdx + 2} / span ${p.span}`, gridRow: p.lane + 1, backgroundColor: tint.bg, borderLeftColor: tint.edge }}
          >
            <span className="truncate">{p.occ.title || t("grid.untitled")}</span>
            {p.occ.is_recurring ? <RepeatIcon size={11} className="shrink-0 text-muted" /> : null}
          </m.button>
        );
      })}
      </AnimatePresence>
    </div>
  );
}
