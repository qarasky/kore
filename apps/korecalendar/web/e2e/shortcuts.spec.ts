import { expect, test } from "@playwright/test";
import { addDays, editor, freshOwner, login, openWeek, today, weekOf } from "./helpers";

const [, , wed] = weekOf(today("UTC"));
const now = today("UTC");

test.describe.serial("keyboard shortcuts", () => {
  test.beforeAll(async () => {
    await freshOwner({ timezone: "UTC" });
  });
  test.beforeEach(async ({ page }) => {
    await login(page);
    await openWeek(page, wed);
    await page.locator("body").click({ position: { x: 5, y: 5 } }); // nothing focused
  });

  test("t goes to today and j/k (or the arrows) step through the periods", async ({ page }) => {
    await page.keyboard.press("t");
    await expect(page).toHaveURL(new RegExp(`/calendar/week\\?date=${now}`));
    await page.keyboard.press("j");
    await expect(page).toHaveURL(new RegExp(`date=${addDays(now, 7)}`));
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(page).toHaveURL(new RegExp(`date=${addDays(now, -7)}`));
  });

  test("d, w, m and a switch views and keep the day", async ({ page }) => {
    for (const [key, view] of [
      ["d", "day"],
      ["m", "month"],
      ["a", "agenda"],
      ["w", "week"],
    ] as const) {
      await page.keyboard.press(key);
      await expect(page).toHaveURL(new RegExp(`/calendar/${view}\\?date=${wed}`));
    }
  });

  test("c opens a new event, and typing a title with these letters doesn't trigger anything", async ({ page }) => {
    await page.keyboard.press("c");
    const dialog = editor(page);
    await expect(dialog).toBeVisible();
    // The title field is focused: every letter below is a shortcut elsewhere.
    await page.keyboard.type("Walk the dog, meet a mate");
    await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue("Walk the dog, meet a mate");
    await expect(page).toHaveURL(new RegExp(`/calendar/week\\?date=${wed}`));
    await expect(page.locator("dialog[open]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(editor(page)).toHaveCount(0);
  });

  test("? lists the shortcuts and Escape closes it", async ({ page }) => {
    await page.keyboard.press("?");
    const list = page.getByTestId("shortcuts-list");
    await expect(list).toBeVisible();
    await expect(list).toContainText("Go to today");
    await expect(list).toContainText("Week view");
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
  });

  test("/ focuses the search box, and letters typed there stay in it", async ({ page }) => {
    await page.keyboard.press("/");
    const box = page.getByRole("searchbox", { name: "Search events" });
    await expect(box).toBeFocused();
    await page.keyboard.type("meeting");
    await expect(box).toHaveValue("meeting");
    await expect(page).toHaveURL(new RegExp(`/calendar/week\\?date=${wed}`));
  });

  test("g asks for a date and goes there", async ({ page }) => {
    await page.keyboard.press("g");
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toContainText("Go to date");
    await dialog.getByLabel("Date").fill("2027-03-15");
    await dialog.getByRole("button", { name: "Go" }).click();
    await expect(page).toHaveURL(/\/calendar\/week\?date=2027-03-15/);
  });

  test("shortcuts with Ctrl or Alt held are left to the browser", async ({ page }) => {
    await page.keyboard.press("Control+m");
    await page.keyboard.press("Alt+d");
    await expect(page).toHaveURL(new RegExp(`/calendar/week\\?date=${wed}`));
  });
});
