"use client";

import { Checkbox, SidebarNav } from "@qarasky/kore-ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { t } from "@/lib/i18n";
import { setHiddenCalendars } from "@/lib/mutations";
import { useShell } from "./ShellContext";

/** "My calendars": a colour checkbox and name per calendar; pressing one hides
 *  or shows it (kept in a cookie, so the server leaves hidden ones out). The
 *  checkbox carries the calendar's own colour. */
export function CalendarList() {
  const router = useRouter();
  const { calendars, prefs } = useShell();
  const [hidden, setHidden] = useState<Set<string>>(new Set(prefs.hidden));

  function toggle(id: string) {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    setHiddenCalendars([...next]);
    router.refresh();
  }

  return (
    <SidebarNav label={t("calendars.heading")} title={t("calendars.heading")}>
      {calendars.length === 0 ? <li className="px-3 text-sub text-muted">{t("calendars.none")}</li> : null}
      {calendars.map((c) => {
        const visible = !hidden.has(c.id);
        return (
          <li key={c.id}>
            <Checkbox
              checked={visible}
              onCheckedChange={() => toggle(c.id)}
              color={c.color}
              aria-label={t("calendars.show", { name: c.name })}
              label={<span className={`block truncate ${visible ? "text-text" : "text-muted"}`}>{c.name}</span>}
              className="min-h-control-sm w-full items-center gap-3 rounded-ui px-3 py-0 transition-colors hover:bg-white/[0.04] [&>div]:min-w-0 [&>div]:flex-1"
            />
          </li>
        );
      })}
    </SidebarNav>
  );
}
