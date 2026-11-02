"use client";

import { COMPACT_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { compactDays } from "@/lib/range";
import type { Occurrence, View } from "@/lib/types";
import { AgendaList } from "./AgendaList";
import { MonthGrid } from "./MonthGrid";
import { TimeGrid } from "./TimeGrid";

/** Picks the component for the view. */
export function CalendarView({ view, day, days, occurrences }: { view: View; day: string; days: string[]; occurrences: Occurrence[] }) {
  const compact = useMediaQuery(COMPACT_QUERY);
  switch (view) {
    case "day":
      return <TimeGrid days={days} occurrences={occurrences} />;
    case "week":
      // On a phone the week shows three days around the selected one.
      return <TimeGrid days={compact ? compactDays(day) : days} occurrences={occurrences} />;
    case "month":
      return <MonthGrid day={day} days={days} occurrences={occurrences} />;
    case "agenda":
      return <AgendaList days={days} occurrences={occurrences} />;
  }
}
