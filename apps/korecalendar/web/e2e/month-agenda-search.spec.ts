import { expect, test } from "./fixtures";
import { addDays, createEventViaApi, freshOwner, login, today, weekOf } from "./helpers";

const [mon, tue, wed, thu] = weekOf(today("UTC"));
const cell = (page: import("@playwright/test").Page, day: string) => page.locator(`[data-testid=month-cell][data-day="${day}"]`);

test.describe.serial("month, agenda and search", () => {
  test.beforeAll(async () => {
    const token = await freshOwner({ timezone: "UTC" });
    // Five events on one day: a month cell shows three and "+2 more".
    for (const [i, title] of ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].entries()) {
      await createEventViaApi(token, { title, start: `${tue}T${String(9 + i).padStart(2, "0")}:00:00`, end: `${tue}T${String(9 + i).padStart(2, "0")}:45:00` });
    }
    await createEventViaApi(token, { title: "Dentist", notes: "Ask about the retainer", location: "Karl-Marx-Str. 4", start: `${wed}T14:00:00`, end: `${wed}T15:00:00` });
    await createEventViaApi(token, { title: "Offsite", start: addDays(thu, 0), end: addDays(thu, 2), all_day: true });
    await createEventViaApi(token, { title: "Tax office", notes: "Bring the retainer contract", start: `${addDays(mon, 40)}T10:00:00`, end: `${addDays(mon, 40)}T11:00:00` });
  });
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("a month cell shows three events and '+2 more', which opens the rest", async ({ page }) => {
    await page.goto(`/calendar/month?date=${tue}`);
    const c = cell(page, tue);
    await expect(c.getByTestId("event")).toHaveCount(3);
    const more = c.getByTestId("more-events");
    await expect(more).toHaveText("+2 more");
    await more.click();
    const list = page.getByRole("dialog"); // the day's list (a popover, portalled out of the cell)
    await expect(list.getByTestId("event")).toHaveCount(5);
    await expect(list.getByTestId("event").filter({ hasText: "Echo" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a multi-day all-day event appears in every cell it covers", async ({ page }) => {
    await page.goto(`/calendar/month?date=${thu}`);
    await expect(cell(page, thu).getByTestId("event").filter({ hasText: "Offsite" })).toBeVisible();
    await expect(cell(page, addDays(thu, 1)).getByTestId("event").filter({ hasText: "Offsite" })).toBeVisible();
    await expect(cell(page, addDays(thu, 2)).getByTestId("event").filter({ hasText: "Offsite" })).toHaveCount(0);
  });

  test("clicking an empty month cell starts an event on that day", async ({ page }) => {
    await page.goto(`/calendar/month?date=${tue}`);
    await cell(page, addDays(tue, 10)).click({ position: { x: 40, y: 50 } });
    await expect(page.getByLabel("Start date")).toHaveValue(addDays(tue, 10));
  });

  test("agenda lists the next 30 days with a heading per day that has events", async ({ page }) => {
    await page.goto(`/calendar/agenda?date=${mon}`);
    const agenda = page.getByTestId("agenda");
    await expect(agenda).toBeVisible();
    const headings = agenda.locator("h2");
    // Tuesday (5 events), Wednesday, Thursday (all-day, through Friday); the Tax office event is 40 days out.
    await expect(headings).toHaveCount(4);
    const tuesday = agenda.locator("section").nth(0);
    await expect(tuesday.getByTestId("event")).toHaveCount(5);
    await expect(tuesday.getByTestId("event").first()).toContainText("Alpha");
    await expect(agenda.getByTestId("event").filter({ hasText: "Tax office" })).toHaveCount(0);
    // An all-day event spanning two days is listed under both.
    await expect(agenda.getByTestId("event").filter({ hasText: "Offsite" })).toHaveCount(2);
  });

  test("an agenda with nothing in it says so", async ({ page }) => {
    await page.goto(`/calendar/agenda?date=${addDays(mon, 200)}`);
    await expect(page.getByTestId("agenda-empty")).toHaveText("Nothing planned in this period.");
  });

  test("search finds events by title, notes and location, wherever they fall in time", async ({ page }) => {
    await page.goto(`/calendar/week?date=${mon}`);
    const box = page.getByRole("searchbox", { name: "Search events" });
    await box.fill("dentist");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=dentist/);
    await expect(page.getByTestId("result")).toHaveCount(1);

    // The word is in the notes of two different events, one of them 40 days away.
    await box.fill("retainer");
    await box.press("Enter");
    await expect(page.getByTestId("result")).toHaveCount(2);
    await expect(page.getByTestId("result").filter({ hasText: "Tax office" })).toHaveCount(1);

    await box.fill("karl-marx");
    await box.press("Enter");
    await expect(page.getByTestId("result").filter({ hasText: "Dentist" })).toHaveCount(1);
  });

  test("a search with no hits says so, and a hit opens its day", async ({ page }) => {
    await page.goto("/search?q=zebra");
    await expect(page.getByTestId("search-none")).toContainText("zebra");
    await page.goto("/search?q=Dentist");
    await page.getByTestId("result").click();
    await expect(page).toHaveURL(new RegExp(`/calendar/day\\?date=${wed}`));
  });
});
