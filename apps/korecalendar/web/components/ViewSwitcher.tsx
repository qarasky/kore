"use client";

import Link from "next/link";
import { calendarHref } from "@/lib/range";
import { PREF_COOKIES, writePref } from "@/lib/prefs";
import { t, type MessageKey } from "@/lib/i18n";
import { VIEWS, type View } from "@/lib/types";
import { useShell } from "./ShellContext";

/** Day / Week / Month / Agenda as a segmented control of real links. */
export function ViewSwitcher() {
  const { view, day } = useShell();
  return (
    <nav aria-label={t("nav.viewSwitcher")} className="flex overflow-hidden rounded-ui border border-border">
      {VIEWS.map((v: View) => (
        <Link
          key={v}
          href={calendarHref(v, day)}
          aria-current={view === v ? "page" : undefined}
          onClick={() => writePref(PREF_COOKIES.view, v)}
          className={
            "min-h-control-sm px-3 py-1.5 text-sub transition-colors " +
            (view === v ? "bg-raised text-text" : "text-muted hover:bg-raised/60 hover:text-text")
          }
        >
          {t(`view.${v}` as MessageKey)}
        </Link>
      ))}
    </nav>
  );
}
