"use client";

import { m } from "motion/react";
import Link from "next/link";
import { useId } from "react";
import { spring } from "@/lib/motion";
import { calendarHref } from "@/lib/range";
import { PREF_COOKIES, writePref } from "@/lib/prefs";
import { t, type MessageKey } from "@/lib/i18n";
import { VIEWS, type View } from "@/lib/types";
import { useShell } from "./ShellContext";

/** Day / Week / Month / Agenda as a segmented control of real links. */
export function ViewSwitcher() {
  const { view, day } = useShell();
  // One pill that glides to the active segment. Unique per switcher: the top bar and the drawer each have one.
  const pill = useId();
  return (
    <nav aria-label={t("nav.viewSwitcher")} className="flex overflow-hidden rounded-ui border border-border">
      {VIEWS.map((v: View) => (
        <Link
          key={v}
          href={calendarHref(v, day)}
          aria-current={view === v ? "page" : undefined}
          onClick={() => writePref(PREF_COOKIES.view, v)}
          className={
            "relative min-h-control-sm px-3 py-1.5 text-sub transition-colors duration-100 " +
            (view === v ? "text-text" : "text-muted hover:bg-raised/60 hover:text-text")
          }
        >
          {view === v ? <m.span layoutId={pill} transition={spring.settle} className="absolute inset-0 bg-raised" /> : null}
          <span className="relative">{t(`view.${v}` as MessageKey)}</span>
        </Link>
      ))}
    </nav>
  );
}
