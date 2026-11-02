"use client";

import Link from "next/link";
import { useState } from "react";
import { addMonths, isSameMonth, monthGrid, parseDay } from "@/lib/dates";
import { formatDayShort, monthName, weekdayShort } from "@/lib/format";
import { t } from "@/lib/i18n";
import { calendarHref, viewDays } from "@/lib/range";
import { iconButtonClass } from "./Button";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { useShell } from "./ShellContext";

const WEEK_ORDER: Record<string, number> = { sun: 0, mon: 1, sat: 6 };

/** A small month for jumping to a day. Its own arrows browse months without
 *  changing the main view; remount (key) resets it to the current month. */
export function MiniMonth() {
  const { view, day, today, prefs } = useShell();
  const [offset, setOffset] = useState(0);
  const shown = addMonths(day, offset);
  const { year, month } = parseDay(shown);
  const rows = monthGrid(shown, prefs.weekStart);
  const inView = new Set(view === "week" || view === "day" ? viewDays(view, day, prefs.weekStart) : []);
  const target = view ?? prefs.view;
  const first = WEEK_ORDER[prefs.weekStart];

  return (
    <section aria-label={t("calendars.miniMonth")}>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sub font-semibold">
          {monthName(month - 1)} {year}
        </h2>
        <div className="flex">
          <button type="button" aria-label={t("calendars.previousMonth")} className={iconButtonClass()} onClick={() => setOffset((o) => o - 1)}>
            <ChevronLeftIcon size={16} />
          </button>
          <button type="button" aria-label={t("calendars.nextMonth")} className={iconButtonClass()} onClick={() => setOffset((o) => o + 1)}>
            <ChevronRightIcon size={16} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-2xs text-muted">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className="py-1" aria-hidden="true">
            {weekdayShort((first + i) % 7).slice(0, 2)}
          </span>
        ))}
        {rows.flat().map((d) => {
          const isToday = d === today;
          const isSel = d === day && (view === "day" || view === "agenda");
          return (
            <Link
              key={d}
              href={calendarHref(target, d)}
              aria-label={formatDayShort(d) + ` ${parseDay(d).year}`}
              aria-current={isToday ? "date" : undefined}
              className={
                "grid h-7 place-items-center text-meta transition-colors " +
                (isToday
                  ? "rounded-full bg-accent font-semibold text-white"
                  : (isSameMonth(d, shown) ? "text-text" : "text-muted/60") +
                    (inView.has(d) ? " bg-raised" : " hover:bg-raised") +
                    (isSel ? " rounded-full ring-1 ring-accent" : ""))
              }
            >
              {parseDay(d).day}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
