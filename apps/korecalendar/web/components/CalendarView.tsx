"use client";

import { m, useReducedMotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { COMPACT_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { duration, ease, pushDirection, viewEnter } from "@/lib/motion";
import { compactDays } from "@/lib/range";
import type { Occurrence, View } from "@/lib/types";
import { AgendaList } from "./AgendaList";
import { MonthGrid } from "./MonthGrid";
import { TimeGrid } from "./TimeGrid";

/** The view and day last put on screen in this tab: where the next screen's motion comes from. Never set on the server. */
let lastShown: { view: string; day: string } | null = null;

/**
 * The content of a view. When the period changes, it enters with a small push
 * in the direction time moved (next = from the right); switching view only
 * fades. The first screen of a visit does not animate at all, so server-rendered
 * content is never hidden. Refreshing after an edit does not replay it (same key).
 */
export function CalendarView(props: { view: View; day: string; days: string[]; occurrences: Occurrence[] }) {
  // Keyed: each new screen is its own mount, so its entrance is decided once, when it appears.
  return <Screen key={`${props.view}:${props.day}`} {...props} />;
}

function Screen(props: { view: View; day: string; days: string[]; occurrences: Occurrence[] }) {
  const { view, day } = props;
  // Reduced motion (the system's or Settings): fade only. Leaving the offset out of the start
  // state also removes the one frame that would otherwise carry it before Motion strips it.
  const reduced = useReducedMotionConfig();
  const [enter] = useState(() => (lastShown ? viewEnter(reduced ? 0 : pushDirection(lastShown, { view, day })) : null));
  useEffect(() => {
    lastShown = { view, day };
  }, [view, day]);
  return (
    <m.div
      className="h-full"
      initial={enter ? enter.initial : false}
      animate={enter ? { ...enter.animate, transition: { duration: duration.view, ease: ease.standard } } : undefined}
    >
      <ViewBody {...props} />
    </m.div>
  );
}

function ViewBody({ view, day, days, occurrences }: { view: View; day: string; days: string[]; occurrences: Occurrence[] }) {
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
