"use client";

import { useMemo, useSyncExternalStore } from "react";

/** A clock that ticks every `intervalMs` while something is subscribed. */
function createClock(intervalMs: number) {
  let current = new Date();
  return {
    subscribe(onChange: () => void) {
      current = new Date();
      onChange();
      const id = setInterval(() => {
        current = new Date();
        onChange();
      }, intervalMs);
      return () => clearInterval(id);
    },
    get: () => current,
  };
}

/** The current time, refreshed every `intervalMs`. `null` on the server and
 *  during hydration, so server and client agree (no hydration mismatch). */
export function useNow(intervalMs = 60_000): Date | null {
  const clock = useMemo(() => createClock(intervalMs), [intervalMs]);
  return useSyncExternalStore(clock.subscribe, clock.get, () => null);
}
