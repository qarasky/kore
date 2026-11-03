import { expect, test } from "./fixtures";
import {
  addDays,
  allEvents,
  api,
  chooseOption,
  chooseScope,
  createEventViaApi,
  editor,
  eventsTitled,
  fillEditor,
  freshOwner,
  icsEvent,
  importIcs,
  login,
  occurrenceIn,
  occurrences,
  openEditor,
  openNewEvent,
  openWeek,
  saveEditor,
  toast,
  today,
  weekOf,
} from "./helpers";

/** The Wednesday `n` weeks after this week's. */
const wedIn = (n: number) => addDays(weekOf(today("UTC"))[2], 7 * n);

test.describe.serial("recurring events", () => {
  let token = "";
  test.beforeAll(async () => {
    token = await freshOwner({ timezone: "UTC" });
  });
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  /** Titles and starts of a series' occurrences over the next ten weeks. */
  const series = async (title: string) =>
    (await occurrences(token, addDays(wedIn(0), -3), addDays(wedIn(9), 3)))
      .filter((o) => o.title === title || o.title.startsWith(title))
      .map((o) => ({ title: o.title, start: o.start, override: o.is_override }));

  test("create a weekly repeat on Wednesday and Friday from the editor", async ({ page }) => {
    await openWeek(page, wedIn(0));
    const dialog = await openNewEvent(page);
    await fillEditor(dialog, { title: "Gym", startDate: wedIn(0), startTime: "16:00", endDate: wedIn(0), endTime: "17:00" });
    await chooseOption(dialog, "Repeat", "Custom…");
    await dialog.getByRole("button", { name: "Repeat on Friday" }).click();
    await saveEditor(dialog);
    await expect(toast(page, "Event created")).toBeVisible();

    const [gym] = await eventsTitled(token, "Gym");
    expect(gym.rrule).toMatch(/FREQ=WEEKLY/);
    expect(gym.rrule).toMatch(/BYDAY=WE,FR|BYDAY=FR,WE/);
    // The grid shows both days of the week it was created in.
    await expect(occurrenceIn(page, wedIn(0), "Gym")).toHaveCount(1);
    await expect(occurrenceIn(page, addDays(wedIn(0), 2), "Gym")).toHaveCount(1);
  });

  test("editing one occurrence changes only that one", async ({ page }) => {
    await openWeek(page, wedIn(1));
    const dialog = await openEditor(page, occurrenceIn(page, wedIn(1), "Gym"));
    await fillEditor(dialog, { title: "Gym (special)", startTime: "18:00", endTime: "19:00" });
    await saveEditor(dialog);
    await chooseScope(page, "This event", "Save");
    await expect(toast(page, "Event saved")).toBeVisible();

    await expect(occurrenceIn(page, wedIn(1), "Gym (special)")).toHaveCount(1);
    const all = await series("Gym");
    expect(all.filter((o) => o.override)).toEqual([{ title: "Gym (special)", start: `${wedIn(1)}T18:00:00`, override: true }]);
    // Everything else is still the plain 16:00 Gym, including the Friday of the same week and the next Wednesday.
    expect(all.filter((o) => !o.override).every((o) => o.title === "Gym" && o.start.endsWith("T16:00:00"))).toBe(true);
    expect(all.some((o) => o.start === `${addDays(wedIn(1), 2)}T16:00:00`)).toBe(true);
    expect(all.some((o) => o.start === `${wedIn(2)}T16:00:00`)).toBe(true);
    expect(all.some((o) => o.start === `${wedIn(1)}T16:00:00`)).toBe(false);
  });

  test("this and following splits the series at that occurrence", async ({ page }) => {
    await openWeek(page, wedIn(2));
    const dialog = await openEditor(page, occurrenceIn(page, wedIn(2), "Gym"));
    await fillEditor(dialog, { location: "Park" });
    await saveEditor(dialog);
    await chooseScope(page, "This and following events", "Save");
    await expect(toast(page, "Event saved")).toBeVisible();

    const gyms = await eventsTitled(token, "Gym");
    expect(gyms).toHaveLength(2);
    const [old, split] = gyms.sort((a, b) => a.start.localeCompare(b.start));
    expect(old.location).toBe("");
    expect(old.rrule).toMatch(/UNTIL=/);
    expect(split.location).toBe("Park");
    expect(split.start).toBe(`${wedIn(2)}T16:00:00`);
    // Before the split: no location; from it on: Park. The override from before survives.
    const occ = await occurrences(token, addDays(wedIn(0), -3), addDays(wedIn(9), 3));
    const byLoc = (from: string, to: string) => occ.filter((o) => o.title === "Gym" && o.start >= from && o.start < to);
    expect(byLoc(wedIn(0), wedIn(2)).length).toBeGreaterThan(0);
    expect((await series("Gym (special)")).length).toBe(1);
  });

  test("all events changes the whole series", async ({ page }) => {
    await openWeek(page, wedIn(3));
    const dialog = await openEditor(page, occurrenceIn(page, wedIn(3), "Gym"));
    await fillEditor(dialog, { title: "Training" });
    await saveEditor(dialog);
    await chooseScope(page, "All events", "Save");
    await expect(toast(page, "Event saved")).toBeVisible();
    // The "all" scope is the series the occurrence belongs to (the split-off one).
    const trainings = await eventsTitled(token, "Training");
    expect(trainings).toHaveLength(1);
    expect(trainings[0].start).toBe(`${wedIn(2)}T16:00:00`);
    const later = (await series("Training")).filter((o) => o.start >= `${wedIn(2)}`);
    expect(later.length).toBeGreaterThan(3);
    expect(later.every((o) => o.title === "Training")).toBe(true);
  });

  test("delete this event skips one occurrence", async ({ page }) => {
    const id = (await createEventViaApi(token, { title: "Standup", start: `${wedIn(0)}T09:00:00`, end: `${wedIn(0)}T09:15:00`, rrule: "FREQ=DAILY" })).id;
    await openWeek(page, wedIn(1));
    await occurrenceIn(page, wedIn(1), "Standup").click();
    await page.getByTestId("event-popover").getByRole("button", { name: "Delete" }).click();
    await chooseScope(page, "This event", "Delete");
    await expect(toast(page, "Event deleted")).toBeVisible();
    await expect(occurrenceIn(page, wedIn(1), "Standup")).toHaveCount(0);
    await expect(occurrenceIn(page, addDays(wedIn(1), 1), "Standup")).toHaveCount(1);
    const ev = await api<{ exdates: string[] }>(token, "GET", `/api/events/${id}`);
    expect(ev.exdates).toEqual([`${wedIn(1)}T09:00:00`]);
  });

  test("delete this and following ends the series there", async ({ page }) => {
    await openWeek(page, wedIn(2));
    await occurrenceIn(page, wedIn(2), "Standup").click();
    await page.getByTestId("event-popover").getByRole("button", { name: "Delete" }).click();
    await chooseScope(page, "This and following events", "Delete");
    await expect(toast(page, "Event deleted")).toBeVisible();
    await expect(occurrenceIn(page, wedIn(2), "Standup")).toHaveCount(0);
    await expect(occurrenceIn(page, addDays(wedIn(2), 3), "Standup")).toHaveCount(0);
    const rest = await series("Standup");
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((o) => o.start < wedIn(2))).toBe(true);
  });

  test("delete all events removes the series, and Undo brings it back", async ({ page }) => {
    await openWeek(page, wedIn(0));
    await occurrenceIn(page, addDays(wedIn(0), 1), "Standup").click();
    await page.getByTestId("event-popover").getByRole("button", { name: "Delete" }).click();
    await chooseScope(page, "All events", "Delete");
    await expect(toast(page, "Event deleted")).toBeVisible();
    await expect(page.getByTestId("event").filter({ hasText: "Standup" })).toHaveCount(0);
    expect(await series("Standup")).toHaveLength(0);
    await toast(page, "Event deleted").getByRole("button", { name: "Undo" }).click();
    await expect(toast(page, "Event restored")).toBeVisible();
    await expect(occurrenceIn(page, addDays(wedIn(0), 1), "Standup")).toHaveCount(1);
    expect((await series("Standup")).length).toBeGreaterThan(0);
  });

  test("a rule the editor can't express stays exactly as imported, even when the title is edited", async ({ page }) => {
    // The last weekday of each month: BYSETPOS has no control in the editor.
    const rule = "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1";
    const now = new Date();
    let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)); // last day of this month
    while ([0, 6].includes(d.getUTCDay())) d = new Date(d.getTime() - 86_400_000);
    const last = d.toISOString().slice(0, 10);
    const result = await importIcs(token, icsEvent({ uid: "lastweekday@example.com", summary: "Month close", start: `${last}T09:00:00`, end: `${last}T10:00:00`, rrule: rule }));
    expect(result.errors).toEqual([]);
    const [before] = await eventsTitled(token, "Month close");
    const storedRule = before.rrule;
    expect(storedRule).toMatch(/BYSETPOS=-1/);

    await openWeek(page, last);
    const dialog = await openEditor(page, occurrenceIn(page, last, "Month close"));
    await expect(dialog.getByTestId("raw-rule")).toBeVisible();
    await expect(dialog.getByTestId("raw-rule-text")).toContainText("BYSETPOS=-1");
    await fillEditor(dialog, { title: "Month close (finance)" });
    await saveEditor(dialog);
    await chooseScope(page, "All events", "Save");
    await expect(toast(page, "Event saved")).toBeVisible();
    await expect(editor(page)).toHaveCount(0);

    const [after] = await eventsTitled(token, "Month close (finance)");
    expect(after.rrule).toBe(storedRule);
    expect(after.id).toBe(before.id);
    expect((await allEvents(token)).filter((e) => e.rrule.includes("BYSETPOS"))).toHaveLength(1);
  });
});
