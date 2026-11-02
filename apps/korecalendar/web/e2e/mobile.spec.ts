import { expect, test } from "@playwright/test";
import { addDays, column, createEventViaApi, editor, freshOwner, login, today, weekOf } from "./helpers";

const [, , wed] = weekOf(today("UTC"));

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.describe.serial("on a phone", () => {
  test.beforeAll(async () => {
    const token = await freshOwner({ timezone: "UTC" });
    await createEventViaApi(token, { title: "Dentist", start: `${wed}T14:00:00`, end: `${wed}T15:00:00` });
    await createEventViaApi(token, { title: "Gym", start: `${addDays(wed, 1)}T16:00:00`, end: `${addDays(wed, 1)}T17:00:00` });
    await createEventViaApi(token, { title: "Far", start: `${addDays(wed, 6)}T10:00:00`, end: `${addDays(wed, 6)}T11:00:00` });
  });
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  const noSideScroll = async (page: import("@playwright/test").Page) =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  test("the week is three days around the selected one, and next steps three days", async ({ page }) => {
    await page.goto(`/calendar/week?date=${wed}`);
    await expect(page.getByTestId("time-grid")).toBeVisible();
    const cols = page.getByTestId("day-column");
    await expect(cols).toHaveCount(3);
    await expect(cols.nth(0)).toHaveAttribute("data-day", addDays(wed, -1));
    await expect(cols.nth(1)).toHaveAttribute("data-day", wed);
    await expect(cols.nth(2)).toHaveAttribute("data-day", addDays(wed, 1));
    await expect(column(page, wed).locator('[data-testid=event][data-title="Dentist"]')).toBeVisible();
    await expect(column(page, addDays(wed, 1)).locator('[data-testid=event][data-title="Gym"]')).toBeVisible(); // the edge day has its events
    await noSideScroll(page);

    await page.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(new RegExp(`date=${addDays(wed, 3)}`));
    await expect(page.getByTestId("day-column").nth(1)).toHaveAttribute("data-day", addDays(wed, 3));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("–");
  });

  test("the menu drawer holds the views, search and calendars, and closes when you pick something", async ({ page }) => {
    await page.goto(`/calendar/week?date=${wed}`);
    await expect(page.getByTestId("time-grid")).toBeVisible();
    await expect(page.getByTestId("mobile-nav")).toHaveCount(0);
    await page.getByRole("button", { name: "Menu" }).first().tap();
    const nav = page.getByTestId("mobile-nav");
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("checkbox", { name: "Show Personal" })).toBeVisible();
    await expect(nav.getByRole("searchbox", { name: "Search events" })).toBeVisible();
    await nav.getByRole("link", { name: "Month" }).tap();
    await expect(page).toHaveURL(new RegExp(`/calendar/month\\?date=${wed}`));
    await expect(page.getByTestId("mobile-nav")).toHaveCount(0);
  });

  test("tapping an empty slot starts an event there, and + opens the editor", async ({ page }) => {
    await page.goto(`/calendar/week?date=${wed}`);
    const col = column(page, wed);
    await expect(col).toBeVisible();
    const box = (await col.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + (11 / 24) * box.height + 4);
    const dialog = editor(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Start date")).toHaveValue(wed);
    await expect(dialog.getByLabel("Start time")).toHaveValue("11:00");
    await dialog.getByRole("button", { name: "Cancel" }).tap();
    await expect(editor(page)).toHaveCount(0);

    await page.getByRole("button", { name: "New event" }).first().tap();
    await expect(editor(page)).toBeVisible();
    await noSideScroll(page);
  });

  test("the month shows dots, and tapping a day opens it", async ({ page }) => {
    await page.goto(`/calendar/month?date=${wed}`);
    const cell = page.locator(`[data-testid=month-cell][data-day="${wed}"]`);
    await expect(cell).toBeVisible();
    await expect(cell.getByTestId("month-dot")).toHaveCount(1);
    await expect(cell.getByTestId("event")).toHaveCount(0);
    await noSideScroll(page);
    await cell.tap();
    await expect(page).toHaveURL(new RegExp(`/calendar/day\\?date=${wed}`));
    await expect(page.getByTestId("day-column")).toHaveCount(1);
  });
});
