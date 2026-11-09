import type { AppNames } from "@qarasky/kore-ui";

/**
 * Kore platform constants for kore-ui's identity parts. The product is shown
 * as KoreMonitor; the `flatline` app key below is Kore ID's identifier for it
 * (technical, not shown), so the switcher, account menu and sign-in screen get
 * the display name through `names`.
 */
export const KORE_APP = "flatline" as const;
export const KORE_NAMES: AppNames = { flatline: "KoreMonitor" };

/** The cookie that remembers a collapsed sidebar ("false" = collapsed), read on the server. */
export const SIDEBAR_COOKIE = "sidebar_state";
