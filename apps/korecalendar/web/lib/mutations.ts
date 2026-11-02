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

import type { Plan, Request } from "./editPlan";
import type { EditResult, Event } from "./types";

/** Sends one planned request (`PATCH` with `If-Match` when the plan carries a version). */
export async function sendRequest<T = unknown>(req: Request): Promise<T> {
  const headers: Record<string, string> = {};
  if (req.ifMatch !== undefined) headers["If-Match"] = `"${req.ifMatch}"`;
  return api<T>(req.path, { method: req.method, body: req.body ? JSON.stringify(req.body) : undefined, headers });
}

/** Runs a plan's requests in order; resolves to each response. */
export async function runPlan(plan: Plan): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const req of plan.requests) out.push(await sendRequest(req));
  return out;
}

export function fetchEvent(id: string, signal?: AbortSignal): Promise<Event> {
  return api<Event>(`/api/events/${encodeURIComponent(id)}`, { signal });
}

/** Brings back an event deleted less than 30 days ago (Undo after a delete). */
export function restoreEvent(id: string): Promise<Event> {
  return api<Event>(`/api/events/${encodeURIComponent(id)}/restore`, { method: "POST" });
}

export type { EditResult };

import type { Calendar, ImportResult, Token, User } from "./types";

export function updateTimezone(timezone: string): Promise<User> {
  return api<User>("/api/me", { method: "PATCH", body: JSON.stringify({ timezone }) });
}

export function createCalendar(name: string, color: string): Promise<Calendar> {
  return api<Calendar>("/api/calendars", { method: "POST", body: JSON.stringify({ name, color }) });
}

export function updateCalendar(id: string, patch: { name?: string; color?: string }): Promise<Calendar> {
  return api<Calendar>(`/api/calendars/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

/** Deletes a calendar; one with events is refused (409) unless `force`, which takes its events along (restorable for 30 days). */
export function deleteCalendar(id: string, force = false): Promise<void> {
  return api<void>(`/api/calendars/${encodeURIComponent(id)}${force ? "?force=1" : ""}`, { method: "DELETE" });
}

export function restoreCalendar(id: string): Promise<Calendar> {
  return api<Calendar>(`/api/calendars/${encodeURIComponent(id)}/restore`, { method: "POST" });
}

export function createToken(name: string): Promise<{ id: string; name: string; token: string }> {
  return api("/api/tokens", { method: "POST", body: JSON.stringify({ name }) });
}

export function revokeToken(id: string): Promise<void> {
  return api<void>(`/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function listTokens(): Promise<Token[]> {
  return api<Token[]>("/api/tokens");
}

/** Imports the text of an .ics file. */
export function importIcs(text: string, calendarId?: string): Promise<ImportResult> {
  const q = calendarId ? `?calendar_id=${encodeURIComponent(calendarId)}` : "";
  return api<ImportResult>(`/api/import${q}`, { method: "POST", body: text, headers: { "content-type": "text/calendar" } });
}

export function createUser(email: string, password: string, role: "user" | "admin"): Promise<User> {
  return api<User>("/api/admin/users", { method: "POST", body: JSON.stringify({ email, password, role }) });
}
