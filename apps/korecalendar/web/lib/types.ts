/** Shapes of the KoreCalendar API (docs/openapi.yaml). Times are wall-clock
 *  strings in the event's own zone; `*_utc` fields are RFC 3339 instants. */

export type Role = "admin" | "user";

export type User = { id: string; email: string; role: Role; timezone: string };

export type Calendar = { id: string; name: string; color: string; created_at: number };

export type Reminder = { minutes_before: number };

export type Event = {
  id: string;
  calendar_id: string;
  title: string;
  notes: string;
  location: string;
  start: string;
  end: string;
  tz: string;
  all_day: boolean;
  rrule: string;
  rdates: string[];
  exdates: string[];
  reminders: Reminder[];
  version: number;
  ics_uid?: string;
  created_by: string;
  updated_by: string;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
};

export type Occurrence = {
  event_id: string;
  calendar_id: string;
  /** The occurrence's original start: its identity inside a series. */
  key: string;
  title: string;
  notes: string;
  location: string;
  start: string;
  end: string;
  tz: string;
  all_day: boolean;
  is_recurring: boolean;
  is_override: boolean;
  start_utc: string;
  end_utc: string;
  reminders: Reminder[];
};

export type Token = { id: string; name: string; created_at: number; last_used_at: number };

export type EditResult = Event & { created?: Event; dropped_overrides?: string[] };

export type ImportIssue = { index: number; uid: string; reason: string };

export type ImportResult = {
  imported: number;
  created: number;
  updated: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
};

export type View = "day" | "week" | "month" | "agenda";
export const VIEWS: readonly View[] = ["day", "week", "month", "agenda"];
export type WeekStart = "mon" | "sun" | "sat";
export type Clock = "24h" | "12h";
