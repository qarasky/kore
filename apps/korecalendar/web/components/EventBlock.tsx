"use client";

import { t } from "@/lib/i18n";
import { calendarTint } from "@/lib/colors";
import { formatTime } from "@/lib/format";
import type { Placed } from "@/lib/layout";
import { utcToLocal } from "@/lib/tz";
import type { Clock } from "@/lib/types";
import { RepeatIcon } from "./icons";

/** A timed event on the grid: tinted fill, coloured left edge, the title and
 *  the time in the calendar's colour. A real button, so it takes focus and Enter. */
export function EventBlock({
  placed,
  color,
  tz,
  clock,
  onOpen,
  state = "normal",
  onPointerDown,
  onResizeStart,
  onKeyDown,
}: {
  placed: Placed;
  color: string;
  tz: string;
  clock: Clock;
  onOpen: (el: HTMLElement) => void;
  /** `source` is the block being dragged (dimmed); `ghost` is where it would land. */
  state?: "normal" | "source" | "ghost";
  onPointerDown?: (e: React.PointerEvent) => void;
  /** Present when the bottom edge can be dragged to resize. */
  onResizeStart?: (e: React.PointerEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const { occ, col, cols, span, top, height, continuesBefore, continuesAfter } = placed;
  const tint = calendarTint(color);
  const startMin = utcToLocal(new Date(occ.start_utc), tz).minutes;
  const when = continuesBefore ? t("grid.continues") : formatTime(startMin, clock);
  const title = occ.title || t("grid.untitled");
  const short = height < 45;

  return (
    <button
      type="button"
      data-testid="event"
      data-event-id={occ.event_id}
      data-key={occ.key}
      data-title={occ.title}
      aria-label={t("grid.eventLabel", { title, when: `${formatTime(startMin, clock)}` })}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(e.currentTarget);
      }}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={
        "absolute touch-manipulation overflow-hidden border-l-[3px] px-1.5 text-left text-2xs leading-tight text-text transition-[filter] hover:brightness-125 " +
        (state === "source" ? "opacity-40 " : "") +
        (state === "ghost" ? "pointer-events-none z-30 ring-2 ring-accent " : "") +
        (continuesBefore ? "rounded-t-none " : "rounded-t-[4px] ") +
        (continuesAfter ? "rounded-b-none " : "rounded-b-[4px] ") +
        "rounded-r-[4px]"
      }
      style={{
        top: `calc(var(--hour) * ${top / 60})`,
        height: `calc(var(--hour) * ${height / 60} - 1px)`,
        left: `calc(${(col / cols) * 100}% + 1px)`,
        width: `calc(${(span / cols) * 100}% - 3px)`,
        backgroundColor: tint.bg,
        borderLeftColor: tint.edge,
      }}
    >
      {short ? (
        <span className="flex h-full items-center gap-1 whitespace-nowrap">
          <span className="min-w-0 truncate font-medium">{title}</span>
          {/* In a narrow column (three or more events side by side) the title
              is what matters; the time and the repeat mark would crowd it out. */}
          {cols < 3 ? (
            <span className="shrink-0" style={{ color: tint.text }}>
              {when}
            </span>
          ) : null}
          {occ.is_recurring && cols < 3 ? <RepeatIcon size={11} className="shrink-0 text-muted" /> : null}
        </span>
      ) : (
        <span className="block py-1">
          <span className="line-clamp-2 font-medium break-words">{title}</span>
          <span className="mt-0.5 flex items-center gap-1" style={{ color: tint.text }}>
            {when}
            {occ.is_recurring ? <RepeatIcon size={11} aria-label={t("grid.repeats")} /> : null}
          </span>
        </span>
      )}
      {onResizeStart ? (
        <span
          data-resize-handle
          role="presentation"
          aria-label={t("grid.resize", { title })}
          onPointerDown={onResizeStart}
          onClick={(e) => e.stopPropagation()}
          // At most 30% of a short block, so the middle of a 15-minute event still opens it.
          style={{ height: "min(0.375rem, 30%)" }}
          className="absolute inset-x-0 bottom-0 cursor-ns-resize"
        />
      ) : null}
    </button>
  );
}
