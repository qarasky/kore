"use client";

import type { Occurrence, View } from "@/lib/types";
import { AgendaList } from "./AgendaList";
import { MonthGrid } from "./MonthGrid";
import { TimeGrid } from "./TimeGrid";

/** Picks the component for the view. */
export function CalendarView({ view, day, days, occurrences }: { view: View; day: string; days: string[]; occurrences: Occurrence[] }) {
  switch (view) {
    case "day":
    case "week":
      return <TimeGrid days={days} occurrences={occurrences} />;
    case "month":
      return <MonthGrid day={day} days={days} occurrences={occurrences} />;
    case "agenda":
      return <AgendaList days={days} occurrences={occurrences} />;
  }
}
