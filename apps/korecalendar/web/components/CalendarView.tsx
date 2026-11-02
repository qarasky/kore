"use client";

import type { Occurrence, View } from "@/lib/types";

/** Placeholder until the grid, month and agenda views land: lists what the
 *  server loaded for the range. */
export function CalendarView({ view, day, days, occurrences }: { view: View; day: string; days: string[]; occurrences: Occurrence[] }) {
  return (
    <div className="h-full overflow-auto p-4" data-view={view} data-day={day} data-days={days.length}>
      <ul>
        {occurrences.map((o) => (
          <li key={o.event_id + o.key}>
            {o.start} {o.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
