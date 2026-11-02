import { expect, test } from "@playwright/test";
import {
  OWNER,
  api,
  calendars,
  chooseOption,
  clockIn,
  column,
  createEventViaApi,
  freshOwner,
  login,
  occurrences,
  openWeek,
  toast,
  today,
  weekOf,
  addDays,
} from "./helpers";
import { API_URL, BASE_URL } from "./harness/env";

const [mon, tue, wed] = weekOf(today("UTC"));

test.describe.serial("settings", () => {
  let token = "";
  test.beforeAll(async () => {
    token = await freshOwner({ timezone: "UTC" });
    const work = await api<{ id: string }>(token, "POST", "/api/calendars", { name: "Work", color: "#7b6cf0" });
    await createEventViaApi(token, { title: "Standup", start: `${wed}T09:00:00`, end: `${wed}T09:30:00` });
    await createEventViaApi(token, { title: "Roadmap", start: `${wed}T13:00:00`, end: `${wed}T14:00:00`, calendar_id: work.id });
  });
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("changing the time zone shifts every event on the grid", async ({ page }) => {
    await openWeek(page, wed);
    await expect(column(page, wed).locator('[data-testid=event][data-title="Standup"]')).toHaveAttribute("aria-label", /, 09:00$/);

    await page.goto("/settings");
    await page.getByRole("combobox", { name: "Your time zone" }).click();
    await page.keyboard.type("America/New_Y");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await api<{ timezone: string }>(token, "GET", "/api/me")).timezone).toBe("America/New_York");

    const [occ] = (await occurrences(token, wed, addDays(wed, 1))).filter((o) => o.title === "Standup");
    await openWeek(page, wed);
    await expect(page.locator('[data-testid=event][data-title="Standup"]')).toHaveAttribute("aria-label", new RegExp(`, ${clockIn(occ.start_utc, "America/New_York")}$`));
    expect(clockIn(occ.start_utc, "America/New_York")).not.toBe("09:00");
    await api(token, "PATCH", "/api/me", { timezone: "UTC" });
  });

  test("week start and the clock format are remembered", async ({ page }) => {
    await page.goto("/settings");
    await chooseOption(page, "Week starts on", "Sunday");
    await chooseOption(page, "Time format", /12-hour/);
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Week starts on" })).toContainText("Sunday");
    await openWeek(page, wed);
    const firstDay = await page.getByTestId("day-column").first().getAttribute("data-day");
    expect(firstDay).toBe(addDays(mon, -1)); // the Sunday before the Monday
    await expect(page.locator('[data-testid=event][data-title="Standup"]')).toHaveAttribute("aria-label", /, 9:00 AM$/);
    await page.goto("/settings");
    await chooseOption(page, "Week starts on", "Monday");
    await chooseOption(page, "Time format", /24-hour/);
  });

  test("calendars: add, rename, recolour, delete and undo", async ({ page }) => {
    await page.goto("/settings/calendars");
    const rows = page.getByTestId("calendar-row");
    await expect(rows).toHaveCount(2);

    await page.getByRole("button", { name: "Add a calendar" }).click();
    await page.locator("#new-cal-name").fill("Errands");
    await page.getByRole("button", { name: "Create calendar" }).click();
    await expect(rows).toHaveCount(3);

    await page.getByRole("button", { name: "Rename and recolour Errands" }).click();
    await page.locator('input[id^="name-"]').fill("Chores");
    await page.getByRole("radio", { name: "Colour #4fb286" }).click();
    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(rows.filter({ hasText: "Chores" })).toHaveCount(1);
    expect((await calendars(token)).find((c) => c.name === "Chores")?.color).toBe("#4fb286");

    // An empty calendar goes at once, with Undo.
    await page.getByRole("button", { name: "Delete Chores" }).click();
    await expect(rows).toHaveCount(2);
    await toast(page, "Calendar deleted").getByRole("button", { name: "Undo" }).click();
    await expect(rows).toHaveCount(3);

    // One with events asks first, and Undo brings the events back with it.
    await page.getByRole("button", { name: "Delete Work" }).click();
    await expect(page.getByText("Delete this calendar with its events?")).toBeVisible();
    await page.getByRole("button", { name: "Delete calendar and events" }).click();
    await expect(rows).toHaveCount(2);
    expect((await occurrences(token, wed, addDays(wed, 1))).some((o) => o.title === "Roadmap")).toBe(false);
    await toast(page, "Calendar deleted").getByRole("button", { name: "Undo" }).click();
    await expect(rows).toHaveCount(3);
    expect((await occurrences(token, wed, addDays(wed, 1))).some((o) => o.title === "Roadmap")).toBe(true);
  });

  test("hiding a calendar hides its events and stays hidden after a reload", async ({ page }) => {
    await openWeek(page, wed);
    await expect(page.locator('[data-testid=event][data-title="Roadmap"]')).toHaveCount(1);
    await page.getByRole("checkbox", { name: "Show Work" }).click();
    await expect(page.locator('[data-testid=event][data-title="Roadmap"]')).toHaveCount(0);
    await expect(page.locator('[data-testid=event][data-title="Standup"]')).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId("time-grid")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Show Work" })).not.toBeChecked();
    await expect(page.locator('[data-testid=event][data-title="Roadmap"]')).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Show Work" }).click();
    await expect(page.locator('[data-testid=event][data-title="Roadmap"]')).toHaveCount(1);
  });

  test("access tokens: shown once, work against the API, stop working when revoked", async ({ page, request }) => {
    await page.goto("/settings/tokens");
    await page.locator("#token-name").fill("claude");
    await page.getByRole("button", { name: "Create token" }).click();
    const reveal = page.getByTestId("token-reveal");
    await expect(reveal).toBeVisible();
    const secret = await page.getByTestId("token-secret").innerText();
    expect(secret).toMatch(/^kcal_/);

    // It works against the API, through the same address the web app uses, and the API records who changed what.
    const me = await request.get(`${BASE_URL}/api/me`, { headers: { Authorization: `Bearer ${secret}` } });
    expect(me.status()).toBe(200);
    const made = await request.post(`${BASE_URL}/api/events`, { headers: { Authorization: `Bearer ${secret}` }, data: { title: "By agent", start: `${tue}T08:00:00` } });
    expect((await made.json()).updated_by).toBe("claude");

    await page.getByRole("button", { name: "I've saved it" }).click();
    await expect(reveal).toHaveCount(0);
    await page.reload();
    expect(await page.content()).not.toContain(secret);
    await expect(page.getByTestId("token-row")).toHaveCount(1);

    // A token cannot mint more tokens.
    const mint = await request.post(`${BASE_URL}/api/tokens`, { headers: { Authorization: `Bearer ${secret}` }, data: { name: "sneaky" } });
    expect(mint.status()).toBeGreaterThanOrEqual(400);

    await page.getByRole("button", { name: "Revoke claude" }).click();
    await page.getByRole("button", { name: "Revoke", exact: true }).last().click();
    await expect(page.getByTestId("token-row")).toHaveCount(0);
    const after = await request.get(`${BASE_URL}/api/me`, { headers: { Authorization: `Bearer ${secret}` } });
    expect(after.status()).toBe(401);
  });

  test("CalDAV: the Settings block gives the address and user name, and a token works as the password", async ({ page, request }) => {
    await page.goto("/settings/tokens");
    const block = page.getByTestId("caldav");
    await expect(block).toBeVisible();
    await expect(block).toContainText("/dav/");
    await expect(block).toContainText(OWNER.email);
    await expect(block).toContainText("access token");

    await page.locator("#token-name").fill("calendar-app");
    await page.getByRole("button", { name: "Create token" }).click();
    const secret = await page.getByTestId("token-secret").innerText();
    const basic = (pw: string) => "Basic " + Buffer.from(`${OWNER.email}:${pw}`).toString("base64");
    const propfind = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
    const ask = (pw: string) =>
      request.fetch(`${API_URL}/dav/`, { method: "PROPFIND", data: propfind, headers: { Authorization: basic(pw), Depth: "0", "Content-Type": "application/xml" } });
    // CalDAV is served by the API itself (Caddy routes /dav/* to it in production; Next's dev server cannot proxy PROPFIND).
    const ok = await ask(secret);
    expect(ok.status()).toBe(207);
    expect(await ok.text()).toContain("current-user-principal");
    expect((await ask(OWNER.password)).status()).toBe(401); // the account password is not accepted
    const wellKnown = await request.get(`${API_URL}/.well-known/caldav`, { maxRedirects: 0 });
    expect(wellKnown.status()).toBe(301);
  });

  test("an admin adds a user who signs in and sees none of the admin's events", async ({ page, browser }) => {
    await page.goto("/settings/users");
    await page.locator("#user-email").fill("guest@korecal.test");
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByTestId("user-reveal")).toBeVisible();
    const password = await page.getByTestId("user-password").innerText();

    const ctx = await browser.newContext();
    const guest = await ctx.newPage();
    await guest.goto("/login");
    await guest.getByLabel("Email").fill("guest@korecal.test");
    await guest.getByLabel("Password").fill(password);
    await guest.getByRole("button", { name: "Sign in" }).click();
    await guest.waitForURL((u) => !u.pathname.startsWith("/login"));
    await openWeek(guest, wed);
    await expect(guest.getByTestId("event")).toHaveCount(0);
    // Another person's things are not found, and the guest is no administrator.
    const adminEvent = (await occurrences(token, wed, addDays(wed, 1)))[0];
    const peek = await guest.request.get(`${BASE_URL}/api/events/${adminEvent.event_id}`);
    expect(peek.status()).toBe(404);
    expect((await guest.goto("/settings/users"))!.status()).toBe(404);
    await ctx.close();
  });
});
