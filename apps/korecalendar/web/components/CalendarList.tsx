"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { t } from "@/lib/i18n";
import { setHiddenCalendars } from "@/lib/mutations";
import { CheckIcon } from "./icons";
import { useShell } from "./ShellContext";

/** "My calendars": a colour swatch and name per calendar; pressing one hides
 *  or shows it (kept in a cookie, so the server leaves hidden ones out). */
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
    <section aria-label={t("calendars.heading")}>
      <h2 className="mb-1.5 text-meta text-muted">{t("calendars.heading")}</h2>
      {calendars.length === 0 ? <p className="text-sub text-muted">{t("calendars.none")}</p> : null}
      <ul className="flex flex-col">
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
                className="flex min-h-control-sm w-full items-center gap-2.5 rounded-ui px-1.5 text-left text-sub hover:bg-raised"
              >
                <span
                  aria-hidden="true"
                  className="grid size-4 shrink-0 place-items-center rounded-[4px] border-2 text-white"
                  style={{ borderColor: c.color, backgroundColor: visible ? c.color : "transparent" }}
                >
                  {visible ? <CheckIcon size={12} strokeWidth={3} /> : null}
                </span>
                <span className={`truncate ${visible ? "" : "text-muted"}`}>{c.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
