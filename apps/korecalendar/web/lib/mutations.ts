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
