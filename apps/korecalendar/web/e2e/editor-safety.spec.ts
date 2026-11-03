import { expect, test } from "@playwright/test";
import { addDays, allEvents, chooseScope, createEventViaApi, editor, eventBlocks, fillEditor, freshOwner, login, occurrenceIn, occurrences, openEditor, openNewEvent, openWeek, saveEditor, toast, today, weekOf } from "./helpers";

const [mon, , wed] = weekOf(today("UTC"));

test.describe.serial("what an editor save must not do", () => {
  let token = "";
  test.beforeAll(async () => {
    token = await freshOwner({ timezone: "UTC" });
    await createEventViaApi(token, { title: "Stand-up", start: `${mon}T09:00:00`, end: `${mon}T09:30:00`, rrule: "FREQ=WEEKLY;BYDAY=MO" });
    await createEventViaApi(token, { title: "Late", start: `${wed}T21:00:00`, end: `${wed}T22:00:00` });
  });
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("pressing Ctrl+Enter twice while the first save is still on its way creates one event", async ({ page }) => {
    await openWeek(page, wed);
    const posts: string[] = [];
    await page.route("**/api/events", async (route) => {
      if (route.request().method() === "POST") {
        posts.push(route.request().postData() ?? "");
        await new Promise((r) => setTimeout(r, 800)); // the response is slow
      }
      await route.continue();
    });
    const dialog = await openNewEvent(page);
    await fillEditor(dialog, { title: "Once only", startDate: wed, startTime: "10:00", endDate: wed, endTime: "11:00" });
    await dialog.getByRole("textbox", { name: "Title" }).focus();
    await page.keyboard.press("Control+Enter");
    await page.keyboard.press("Control+Enter");
    await expect(editor(page)).toHaveCount(0);
    expect(posts).toHaveLength(1);
    expect((await allEvents(token)).filter((e) => e.title === "Once only")).toHaveLength(1);
  });

  test("a create carries an Idempotency-Key, and retrying the same form reuses it", async ({ page }) => {
    await openWeek(page, wed);
    const keys: (string | undefined)[] = [];
    let fail = true;
    await page.route("**/api/events", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      keys.push(route.request().headers()["idempotency-key"]);
      if (fail) {
        fail = false;
        return route.abort("connectionreset"); // the person sees an error and presses Save again
      }
      return route.continue();
    });
    const dialog = await openNewEvent(page);
    await fillEditor(dialog, { title: "Retry me", startDate: wed, startTime: "12:00", endDate: wed, endTime: "13:00" });
    await saveEditor(dialog);
    await expect(dialog.getByRole("alert")).toBeVisible();
    await saveEditor(dialog);
    await expect(editor(page)).toHaveCount(0);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect((await allEvents(token)).filter((e) => e.title === "Retry me")).toHaveLength(1);
  });

  test("changing the time of a series tells the person which changed occurrences were reset", async ({ page }) => {
    const next = addDays(mon, 7);
    await openWeek(page, next);
    // One occurrence was changed by hand.
    const edit = await openEditor(page, occurrenceIn(page, next, "Stand-up"));
    await fillEditor(edit, { title: "Stand-up (special)" });
    await saveEditor(edit);
    await chooseScope(page, "This event", "Save");
    await expect(toast(page, "Event saved")).toBeVisible();
    expect((await occurrences(token, next, addDays(next, 1))).some((o) => o.is_override)).toBe(true);

    // Now the whole series moves to another time: that one-off no longer matches anything.
    await openWeek(page, mon);
    const all = await openEditor(page, occurrenceIn(page, mon, "Stand-up"));
    await fillEditor(all, { startTime: "09:15", endTime: "09:45" });
    await saveEditor(all);
    await chooseScope(page, "All events", "Save");
    await expect(toast(page, /1 changed occurrence/)).toBeVisible();
    expect((await occurrences(token, next, addDays(next, 1))).some((o) => o.is_override)).toBe(false);
  });

  test("the grid keeps its scroll position after a save", async ({ page }) => {
    await openWeek(page, wed);
    const grid = page.getByTestId("time-grid");
    // Anywhere but where the grid opens by itself (which depends on the time of day), so a
    // reset to the opening position cannot pass by coincidence.
    const opening = await grid.evaluate((el) => el.scrollTop);
    // Two targets, both reachable and both well away from the opening position wherever it is.
    await grid.evaluate((el, target) => (el.scrollTop = target), opening < 280 ? 520 : 120);
    const before = await grid.evaluate((el) => el.scrollTop);
    expect(Math.abs(before - opening)).toBeGreaterThan(100);
    const dialog = await openEditor(page, eventBlocks(page, "Late"));
    await fillEditor(dialog, { title: "Late (renamed)" });
    await saveEditor(dialog);
    await expect(toast(page, "Event saved")).toBeVisible();
    await expect(eventBlocks(page, "Late (renamed)")).toHaveCount(1);
    await page.waitForTimeout(300);
    expect(Math.abs((await grid.evaluate((el) => el.scrollTop)) - before)).toBeLessThan(3);
  });
});
