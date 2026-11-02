/** One function per API call the UI makes. Each returns the parsed result or
 *  throws an `ApiError`. Used from client components. */
import { api } from "./api";
import { writePref, PREF_COOKIES } from "./prefs";

export function signOut(): Promise<void> {
  return api<void>("/api/logout", { method: "POST" });
}

/** Stores which calendars are hidden (a cookie, so the server can leave them out). */
export function setHiddenCalendars(ids: string[]): void {
  writePref(PREF_COOKIES.hidden, ids.join(","));
}
