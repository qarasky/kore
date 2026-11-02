"use client";

import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches. `false` on the server and during hydration. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phones: narrower than the layout's `md` breakpoint (and used to simplify grids). */
export const COMPACT_QUERY = "(max-width: 700px)";
