"use client";

import { useSyncExternalStore } from "react";
import { formatFullDate, formatModified } from "@/lib/format";

const noop = () => () => {};

/**
 * "Today 14:05" / "Oct 3" in the browser's time zone. The server doesn't
 * know that zone, so nothing is rendered until hydration (rather than a
 * server-zone time that then changes).
 */
export function RelativeTime({ unixSeconds }: { unixSeconds: number }) {
  const client = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const iso = new Date(unixSeconds * 1000).toISOString();
  return (
    <time dateTime={iso} title={client ? formatFullDate(unixSeconds) : undefined}>
      {client ? formatModified(unixSeconds) : ""}
    </time>
  );
}
