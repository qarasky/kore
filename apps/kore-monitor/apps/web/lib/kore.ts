/**
 * Kore platform constants for kore-ui's identity parts. The `flatline` app key
 * is Kore ID's identifier for KoreMonitor (technical, not shown); kore-ui
 * knows the display name.
 */
export const KORE_APP = "flatline" as const;

/** The cookie that remembers a collapsed sidebar ("false" = collapsed), read on the server. */
export const SIDEBAR_COOKIE = "sidebar_state";
