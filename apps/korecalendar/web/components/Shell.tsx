"use client";

import { AppShell, Wordmark } from "@qarasky/kore-ui";
import { LazyMotion, MotionConfig, domMax } from "motion/react";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { isValidDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { reducedMotionFor } from "@/lib/motion";
import { PREF_COOKIES, writePref, type Prefs } from "@/lib/prefs";
import { parseView } from "@/lib/range";
import { todayIn } from "@/lib/tz";
import type { AuthConfig, Calendar, User } from "@/lib/types";
import { EditorProvider } from "./EditorProvider";
import { ShellProvider } from "./ShellContext";
import { Shortcuts } from "./Shortcuts";
import { CalendarSidebar } from "./Sidebar";
import { CalendarTopBar } from "./TopBar";

/**
 * The frame around every signed-in page: kore-ui's AppShell (top bar, sidebar or drawer, the
 * main panel) with the calendar's state around it. The view and day come from the URL, so
 * navigation is plain links.
 */
export function Shell({
  me,
  calendars,
  prefs,
  kore,
  children,
}: {
  me: User;
  calendars: Calendar[];
  prefs: Prefs;
  kore: AuthConfig["oidc"];
  children: ReactNode;
}) {
  const params = useParams<{ view?: string }>();
  const search = useSearchParams();
  const pathname = usePathname();
  // The drawer is open for the URL it was opened on; navigating anywhere closes it.
  const here = `${pathname}?${search.toString()}`;
  const [drawerFor, setDrawerFor] = useState<string | null>(null);
  const today = todayIn(me.timezone);
  const date = search.get("date");
  const view = parseView(params.view);
  const day = view && date && isValidDay(date) ? date : today;

  // The last view you looked at is where "/" and "Back to calendar" go.
  useEffect(() => {
    if (view) writePref(PREF_COOKIES.view, view);
  }, [view]);

  return (
    <ShellProvider value={{ me, calendars, prefs, view, day, today, kore }}>
      <LazyMotion features={domMax} strict>
        <MotionConfig reducedMotion={reducedMotionFor(prefs.motion)}>
          <EditorProvider>
            <Shortcuts />
            <AppShell
              brand={<Wordmark app="korecalendar" />}
              brandHref="/"
              labels={{ menu: t("nav.menu"), drawer: t("nav.drawer"), close: t("nav.closeMenu") }}
              drawerOpen={drawerFor === here}
              onDrawerOpenChange={(open) => setDrawerFor(open ? here : null)}
              topBar={<CalendarTopBar />}
              sidebar={<CalendarSidebar />}
            >
              {children}
            </AppShell>
          </EditorProvider>
        </MotionConfig>
      </LazyMotion>
    </ShellProvider>
  );
}
