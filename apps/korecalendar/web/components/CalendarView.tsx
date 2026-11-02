"use client";

import type { Occurrence, View } from "@/lib/types";
import { TimeGrid } from "./TimeGrid";

/** Picks the view's component. Month and agenda arrive in the next task. */
export function CalendarView({ view, day, days, occurrences }: { view: View; day: string; days: string[]; occurrences: Occurrence[] }) {
  if (view === "day" || view === "week") {
    return <TimeGrid days={days} occurrences={occurrences} />;
  }
  return (
    <div className="h-full overflow-auto p-4" data-view={view} data-day={day}>
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
