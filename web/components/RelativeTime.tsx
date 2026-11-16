"use client";

import { Time } from "@qarasky/kore-ui";
import { useSyncExternalStore } from "react";
import { activeLocale, t } from "@/lib/i18n";

const noop = () => () => {};

/**
 * "Today 14:05" / "Oct 3" in the browser's time zone (kore-ui `Time`; the
 * exact moment is the tooltip). The server doesn't know that zone, so nothing
 * is rendered until hydration (rather than a server-zone time that then
 * changes).
 */
export function RelativeTime({ unixSeconds }: { unixSeconds: number }) {
  const client = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  if (!client) return <time dateTime={new Date(unixSeconds * 1000).toISOString()} />;
  return <Time value={unixSeconds * 1000} locale={activeLocale()} labels={{ justNow: t("date.justNow") }} />;
}
