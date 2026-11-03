"use client";

import { AnimatePresence, m } from "motion/react";
import { Check } from "lucide-react";
import { SidebarNav } from "@qarasky/kore-ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { duration, ease } from "@/lib/motion";
import { t } from "@/lib/i18n";
import { setHiddenCalendars } from "@/lib/mutations";
import { useShell } from "./ShellContext";

/** "My calendars": a colour swatch and name per calendar; pressing one hides
 *  or shows it (kept in a cookie, so the server leaves hidden ones out). The
 *  swatch is the calendar's own colour, so this is a checkbox list styled as
 *  sidebar items rather than kore-ui's (accent) Checkbox. */
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
            <button
              type="button"
              role="checkbox"
              aria-checked={visible}
              aria-label={t("calendars.show", { name: c.name })}
              onClick={() => toggle(c.id)}
              className="flex min-h-control-sm w-full items-center gap-3 rounded-ui px-3 text-left transition-colors hover:bg-white/[0.04]"
            >
              <span
                aria-hidden="true"
                className="grid size-4 shrink-0 place-items-center rounded-[4px] border-2 text-white transition-colors duration-100"
                style={{ borderColor: c.color, backgroundColor: visible ? c.color : "transparent" }}
              >
                <AnimatePresence initial={false}>
                  {visible ? (
                    <m.span
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1, transition: { duration: duration.feedback, ease: ease.standard } }}
                      exit={{ opacity: 0, scale: 0.5, transition: { duration: duration.feedback, ease: ease.exit } }}
                      className="grid"
                    >
                      <Check size={12} strokeWidth={3} />
                    </m.span>
                  ) : null}
                </AnimatePresence>
              </span>
              <span className={`truncate ${visible ? "text-text" : "text-muted"}`}>{c.name}</span>
            </button>
          </li>
        );
      })}
    </SidebarNav>
  );
}
