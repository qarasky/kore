import { expect, type Locator, type Page } from "@playwright/test";
import { resetApi } from "./harness/api-server";
import { API_URL, BASE_URL, OWNER } from "./harness/env";
import { seedSession, seedUser } from "./harness/session";

export { OWNER };

// ---- dates (plain calendar-day maths; the app's own helpers are unit-tested separately)

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (day: string) => new Date(`${day}T00:00:00Z`);

export function addDays(day: string, n: number): string {
  const d = parse(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Today's date in `tz`, the way the app computes it. */
export function today(tz = "UTC"): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p; // en-CA is YYYY-MM-DD
}

/** The seven days of the week containing `day`, Monday first (the app's default). */
export function weekOf(day: string): string[] {
  const dow = (parse(day).getUTCDay() + 6) % 7; // Mon = 0
  const first = addDays(day, -dow);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/** The calendar day an instant falls on in `tz` (YYYY-MM-DD). */
export function dayIn(instant: string | Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
}

/** Minutes after local midnight an instant shows in `tz`. */
export function minutesIn(instant: string | Date, tz: string): number {
  const [h, m] = clockIn(instant, tz).split(":").map(Number);
  return h * 60 + m;
}

/** The wall-clock "HH:MM" an instant shows in `tz`. */
export function clockIn(instant: string | Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));
}

// ---- auth

/** Sign in without the Kore ID browser round-trip: seed a session and set its cookie. */
export async function login(page: Page, creds: { email: string } = OWNER, next = "/"): Promise<void> {
  const token = seedSession(creds.email);
  await page.context().addCookies([{ name: "korecal_session", value: token, domain: new URL(BASE_URL).hostname, path: "/" }]);
  await page.goto(next);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

// ---- the API, as an agent would use it (straight to the Go API, not through the web server)

export type ApiEvent = Record<string, unknown> & { title: string; start: string };

export async function api<T = unknown>(token: string, method: string, path: string, data?: unknown, base = API_URL): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await res.text();
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** A session token for `creds`, seeding the account if it does not exist. */
export async function apiSession(creds: { email: string } = OWNER): Promise<string> {
  return seedSession(creds.email);
}

/**
 * A clean slate with the owner account already created (directly in the test
 * database, since sign-in is Kore ID only). Returns the owner's session token.
 */
export async function freshOwner(opts: { timezone?: string } = {}): Promise<string> {
  await resetApi();
  const { token } = seedUser(OWNER.email, "admin");
  await api(token, "PATCH", "/api/me", { timezone: opts.timezone ?? "UTC" });
  return token;
}

/** Create an event; `tz` defaults to the user's zone, which `freshOwner` sets. */
export async function createEventViaApi(token: string, body: ApiEvent): Promise<{ id: string; calendar_id: string }> {
  return api(token, "POST", "/api/events", body);
}

export interface ApiOccurrence {
  event_id: string;
  key: string;
  title: string;
  start: string;
  end: string;
  start_utc: string;
  end_utc: string;
  is_override: boolean;
  is_recurring: boolean;
}

export async function occurrences(token: string, fromDay: string, toDay: string): Promise<ApiOccurrence[]> {
  return api(token, "GET", `/api/occurrences?from=${fromDay}T00:00:00Z&to=${toDay}T00:00:00Z`);
}

export interface ApiEventFull {
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
  exdates: string[];
  reminders: { minutes_before: number }[];
  version: number;
}

/** Every live event whose occurrences fall within ±200 days of today (there is no list-events endpoint). */
export async function allEvents(token: string): Promise<ApiEventFull[]> {
  const occ = await occurrences(token, addDays(today("UTC"), -200), addDays(today("UTC"), 190));
  const ids = [...new Set(occ.map((o) => o.event_id))];
  return Promise.all(ids.map((id) => api<ApiEventFull>(token, "GET", `/api/events/${id}`)));
}

export async function eventsTitled(token: string, title: string): Promise<ApiEventFull[]> {
  return (await allEvents(token)).filter((e) => e.title === title);
}

export async function calendars(token: string): Promise<{ id: string; name: string; color: string }[]> {
  return api(token, "GET", "/api/calendars");
}

// ---- UI

/** Open a custom `Select` (never a native <select>) by its accessible name and pick an option. */
export async function chooseOption(scope: Page | Locator, label: string | RegExp, option: string | RegExp): Promise<void> {
  const page = "page" in scope && typeof scope.page === "function" ? scope.page() : (scope as Page);
  await scope.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option }).click();
}

/** Pick a time zone in the searchable time zone picker (a kore-ui Combobox) by typing its name. */
export async function chooseZone(scope: Page | Locator, label: string, zone: string): Promise<void> {
  const page = "page" in scope && typeof scope.page === "function" ? scope.page() : (scope as Page);
  await scope.getByRole("button", { name: label }).click();
  await page.getByRole("combobox").last().fill(zone);
  await page.getByRole("option", { name: new RegExp(`^${zone}`) }).click();
}

export function column(page: Page, day: string): Locator {
  return page.locator(`[data-testid=day-column][data-day="${day}"]`);
}

/** The event blocks with `title` (ignores the drag ghost, which copies the block's markup). */
export function eventBlocks(page: Page, title: string): Locator {
  return page.locator(`[data-testid=event][data-title="${title}"]:not(.ring-accent)`);
}

/** Open the week (or other view) containing `day` and wait for the grid. */
export async function openWeek(page: Page, day: string): Promise<void> {
  await page.goto(`/calendar/week?date=${day}`);
  await expect(page.getByTestId("time-grid")).toBeVisible();
}

/** Where `locator` sits vertically inside `container`, as minutes after the container's top (24h = full height). */
export async function minutesWithin(locator: Locator, container: Locator): Promise<{ top: number; bottom: number }> {
  const [b, c] = await Promise.all([locator.boundingBox(), container.boundingBox()]);
  if (!b || !c) throw new Error("not visible");
  return { top: ((b.y - c.y) / c.height) * 1440, bottom: ((b.y + b.height - c.y) / c.height) * 1440 };
}

// ---- the event editor

export interface EditorFields {
  title?: string;
  allDay?: boolean;
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  location?: string;
  notes?: string;
}

export function editor(page: Page): Locator {
  return page.getByRole("dialog").filter({ has: page.locator("input[name=title]") });
}

/** Click "New event" and wait for the editor. */
export async function openNewEvent(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "New event", exact: true }).first().click();
  const dialog = editor(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Click an event block and then "Edit" in its popover. */
export async function openEditor(page: Page, block: Locator): Promise<Locator> {
  await block.click();
  const popover = page.getByTestId("event-popover");
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "Edit" }).click();
  const dialog = editor(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Type into the editor's plain fields. (Start before end: changing the start moves the end with it.) */
export async function fillEditor(dialog: Locator, f: EditorFields): Promise<void> {
  if (f.title !== undefined) await dialog.getByRole("textbox", { name: "Title" }).fill(f.title);
  if (f.allDay !== undefined) {
    const sw = dialog.getByRole("switch", { name: "All day" });
    if ((await sw.getAttribute("aria-checked")) !== String(f.allDay)) await sw.click();
  }
  if (f.startDate !== undefined) await dialog.getByLabel("Start date").fill(f.startDate);
  if (f.startTime !== undefined) await dialog.getByLabel("Start time").fill(f.startTime);
  if (f.endDate !== undefined) await dialog.getByLabel("End date").fill(f.endDate);
  if (f.endTime !== undefined) await dialog.getByLabel("End time").fill(f.endTime);
  if (f.location !== undefined) await dialog.getByLabel("Location").fill(f.location);
  if (f.notes !== undefined) await dialog.getByLabel("Notes").fill(f.notes);
}

export async function saveEditor(dialog: Locator): Promise<void> {
  await dialog.getByRole("button", { name: "Save" }).click();
}

/** The toast with `text` (kore-ui's toasts are list items in the "Notifications" region). */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.getByRole("region", { name: /^Notifications/ }).getByRole("listitem").filter({ hasText: text });
}

/** Answer a "which events?" dialog. */
export async function chooseScope(page: Page, scope: "This event" | "This and following events" | "All events", confirm: string): Promise<void> {
  const dialog = page.getByRole("alertdialog").filter({ has: page.getByRole("radiogroup") });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(scope, { exact: true }).check();
  await dialog.getByRole("button", { name: confirm, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/** Open the popover of the occurrence of `title` in `day`'s column (week view). */
export function occurrenceIn(page: Page, day: string, title: string): Locator {
  return column(page, day).locator(`[data-testid=event][data-title="${title}"]`);
}

/** The ICS text for one event (UTC), as an agent or another calendar would export it. */
export function icsEvent(f: { uid: string; summary: string; start: string; end: string; rrule?: string }): string {
  const z = (s: string) => s.replace(/[-:]/g, "") + "Z";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//korecalendar e2e//EN",
    "BEGIN:VEVENT",
    `UID:${f.uid}`,
    "DTSTAMP:20260101T000000Z",
    `DTSTART:${z(f.start)}`,
    `DTEND:${z(f.end)}`,
    `SUMMARY:${f.summary}`,
    ...(f.rrule ? [`RRULE:${f.rrule}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export async function importIcs(token: string, ics: string): Promise<{ imported: number; created: number; errors: unknown[] }> {
  const res = await fetch(`${API_URL}/api/import`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/calendar" }, body: ics });
  if (res.status >= 300) throw new Error(`import failed: ${res.status} ${await res.text()}`);
  return res.json();
}
