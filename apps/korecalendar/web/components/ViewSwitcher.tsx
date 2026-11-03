"use client";

import { NavTabs } from "@qarasky/kore-ui";
import { calendarHref } from "@/lib/range";
import { t, type MessageKey } from "@/lib/i18n";
import { VIEWS } from "@/lib/types";
import { useShell } from "./ShellContext";

/** Day / Week / Month / Agenda: kore-ui pill tabs, each a real link. */
export function ViewSwitcher({ className }: { className?: string }) {
  const { view, day } = useShell();
  return (
    <NavTabs
      label={t("nav.viewSwitcher")}
      className={className}
      items={VIEWS.map((v) => ({ href: calendarHref(v, day), label: t(`view.${v}` as MessageKey), active: view === v }))}
    />
  );
}
