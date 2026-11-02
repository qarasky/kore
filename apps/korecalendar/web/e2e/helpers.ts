import { expect, type Locator, type Page } from "@playwright/test";
import { resetApi } from "./harness/api-server";
import { API_URL, OWNER } from "./harness/env";

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

/** First-run: create the owner account through the UI (leaves the page signed in). */
export async function setup(page: Page, creds = OWNER): Promise<void> {
  await page.goto("/setup");
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Create your account" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/setup"));
}

export async function login(page: Page, creds = OWNER, next = "/"): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
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

/** A session token for `creds`. */
export async function apiSession(creds = OWNER): Promise<string> {
  const res = await fetch(`${API_URL}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(creds) });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { token: string }).token;
}

/**
 * A clean slate with the owner account already created (through the API, so specs
 * that are not about sign-up skip the form). Returns the owner's session token.
 */
export async function freshOwner(opts: { timezone?: string } = {}): Promise<string> {
  await resetApi();
  const res = await fetch(`${API_URL}/api/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(OWNER) });
  if (res.status >= 300) throw new Error(`setup failed: ${res.status} ${await res.text()}`);
  const token = ((await res.json()) as { token: string }).token;
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
