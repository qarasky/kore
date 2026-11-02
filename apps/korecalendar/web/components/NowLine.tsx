"use client";

import { useNow } from "@/hooks/useNow";
import { t } from "@/lib/i18n";
import { utcToLocal } from "@/lib/tz";

/** The red "now" line across today's column. Renders nothing for other days. */
export function NowLine({ day, tz }: { day: string; tz: string }) {
  const now = useNow();
  if (!now) return null;
  const local = utcToLocal(now, tz);
  if (local.day !== day) return null;
  return (
    <div
      role="presentation"
      aria-label={t("grid.nowLine")}
      data-testid="now-line"
      className="pointer-events-none absolute right-0 left-0 z-20 border-t-2 border-danger"
      style={{ top: `calc(var(--hour) * ${local.minutes / 60})` }}
    >
      <span className="absolute -top-[5px] -left-1 size-2 rounded-full bg-danger" />
    </div>
  );
}
