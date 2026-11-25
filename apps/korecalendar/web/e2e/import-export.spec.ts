import { expect, test } from "./fixtures";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createEventViaApi, freshOwner, login, occurrences, today, weekOf } from "./helpers";
import { FIXTURES } from "./harness/env";

test.describe.serial("import and export", () => {
  let token = "";
  test.beforeAll(async () => {
    token = await freshOwner({ timezone: "Europe/Berlin" });
  });
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("importing a Google Calendar file brings in its events, exclusions and changed occurrences", async ({ page }) => {
    await page.goto("/settings/import-export");
    await page.setInputFiles("[data-testid=import-file]", join(FIXTURES, "google.ics"));
    const summary = page.getByTestId("import-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("Imported 2 events");
    await expect(page.getByTestId("import-issue")).toHaveCount(0);

    const occ = await occurrences(token, "2026-01-01", "2026-12-31");
    const sync = occ.filter((o) => o.title.startsWith("Team sync"));
    // 2nd Tuesday monthly, minus the excluded 10 Mar, with 10 Feb moved and renamed.
    expect(sync.some((o) => o.start.startsWith("2026-01-13T10:00"))).toBe(true);
    expect(sync.some((o) => o.start.startsWith("2026-03-10"))).toBe(false);
    expect(sync.find((o) => o.title === "Team sync (moved)")?.start).toMatch(/^2026-02-10T14:00/);

    await page.goto("/calendar/month?date=2026-02-10");
    await expect(page.locator('[data-testid=month-cell][data-day="2026-02-10"]').getByTestId("event").filter({ hasText: "Team sync (moved)" })).toBeVisible();
    await page.goto("/calendar/month?date=2026-12-24");
    await expect(page.locator('[data-testid=month-cell][data-day="2026-12-24"]').getByTestId("event").filter({ hasText: "Christmas break" })).toBeVisible();
  });

  test("a file with problem events reports each one while the rest go in", async ({ page }) => {
    await page.goto("/settings/import-export");
    await page.setInputFiles("[data-testid=import-file]", join(FIXTURES, "unsupported.ics"));
    const summary = page.getByTestId("import-summary");
    await expect(summary).toContainText("Imported 1 event");
    const issues = page.getByTestId("import-issue");
    await expect(issues).toHaveCount(3);
    await expect(summary).toContainText("hourly@example.com");
    await expect(summary).toContainText("nostart@example.com");
    await expect(summary).toContainText("byweek@example.com");
    expect((await occurrences(token, "2026-01-01", "2027-01-01")).some((o) => o.title === "Fine")).toBe(true);
  });

  test("importing the same file again updates instead of duplicating", async ({ page }) => {
    const count = async () => (await occurrences(token, "2026-01-01", "2026-12-31")).filter((o) => o.title === "Christmas break").length;
    expect(await count()).toBe(1);
    await page.goto("/settings/import-export");
    await page.setInputFiles("[data-testid=import-file]", join(FIXTURES, "google.ics"));
    await expect(page.getByTestId("import-summary")).toContainText("0 new");
    expect(await count()).toBe(1);
  });

  test("export downloads an .ics that contains the events with recurring and imported events in it", async ({ page }) => {
    const [wed] = [weekOf(today("Europe/Berlin"))[2]];
    await createEventViaApi(token, { title: "Round trip", start: `${wed}T09:30:00`, end: `${wed}T10:00:00`, rrule: "FREQ=WEEKLY;BYDAY=WE" });
    await page.goto("/settings/import-export");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download .ics" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^calendar-\d{4}-\d{2}-\d{2}\.ics$/);
    const text = readFileSync(await download.path(), "utf8");
    expect(text).toContain("BEGIN:VCALENDAR");
    for (const needle of ["SUMMARY:Round trip", "SUMMARY:Team sync", "RRULE:FREQ=WEEKLY;BYDAY=WE", "SUMMARY:Christmas break"]) expect(text).toContain(needle);
    expect((text.match(/BEGIN:VEVENT/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
