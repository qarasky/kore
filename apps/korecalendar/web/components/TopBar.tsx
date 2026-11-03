"use client";

import { Button, IconButton, TopBar } from "@qarasky/kore-ui";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { COMPACT_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { formatDayTitle } from "@/lib/format";
import { t } from "@/lib/i18n";
import { calendarHref, navigate } from "@/lib/range";
import { AccountMenu, KoreAppSwitcher } from "./AccountMenu";
import { useEditor } from "./EditorContext";
import { useShell } from "./ShellContext";
import { ViewSwitcher } from "./ViewSwitcher";

/**
 * kore-ui's TopBar: period navigation, title and the view tabs in the middle; New event, apps and
 * account on the right. Search lives at the top of the sidebar: with a calendar's period controls
 * there is no room for it in the bar at laptop widths.
 */
export function CalendarTopBar() {
  const { view, day, today, prefs } = useShell();
  const { openNew } = useEditor();
  const compact = useMediaQuery(COMPACT_QUERY);

  return (
    <TopBar
      actions={
        <>
          <Button variant="primary" onClick={() => openNew()} className="max-sm:hidden">
            <Plus />
            {t("nav.newEvent")}
          </Button>
          <IconButton variant="primary" size="md" label={t("nav.newEvent")} tooltip={false} icon={<Plus />} onClick={() => openNew()} className="sm:hidden" />
          <KoreAppSwitcher />
          <AccountMenu />
        </>
      }
    >
      {view ? (
        <div className="flex min-w-0 items-center gap-1">
          <Button asChild size="sm" className="mr-1">
            <Link href={calendarHref(view, today)}>{t("nav.today")}</Link>
          </Button>
          <IconButton asChild label={t("nav.previous")}>
            <Link href={calendarHref(view, navigate(view, day, -1, compact))}>
              <ChevronLeft />
            </Link>
          </IconButton>
          <IconButton asChild label={t("nav.next")}>
            <Link href={calendarHref(view, navigate(view, day, 1, compact))}>
              <ChevronRight />
            </Link>
          </IconButton>
          <h1 className="ml-1 truncate text-heading font-semibold tracking-[-0.01em] max-sm:text-sub" aria-live="polite">
            {formatDayTitle(day, view, prefs.weekStart, compact)}
          </h1>
        </div>
      ) : (
        <Button asChild variant="ghost" size="sm">
          <Link href={calendarHref(prefs.view, today)}>
            <ChevronLeft />
            {t("nav.backToCalendar")}
          </Link>
        </Button>
      )}
      <div className="flex-1" />
      <ViewSwitcher className="hidden shrink-0 md:flex" />
    </TopBar>
  );
}
