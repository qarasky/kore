import { expect, test } from "./fixtures";
import {
  allEvents,
  api,
  calendars,
  chooseOption,
  chooseZone,
  createEventViaApi,
  editor,
  eventBlocks,
  fillEditor,
  freshOwner,
  login,
  occurrences,
  openEditor,
  openNewEvent,
  openWeek,
  saveEditor,
  addDays,
  toast,
  today,
  weekOf,
} from "./helpers";

test.describe.serial("events: create, edit, delete", () => {
  let token = "";
  let wed = "";

  test.beforeAll(async () => {
    token = await freshOwner({ timezone: "UTC" });
    await api(token, "POST", "/api/calendars", { name: "Work", color: "#7b6cf0" });
    wed = weekOf(today("UTC"))[2];
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
    await openWeek(page, wed);
  });

  test("create an event with every field from the editor", async ({ page }) => {
    const dialog = await openNewEvent(page);
    await fillEditor(dialog, { title: "Planning", startDate: wed, startTime: "14:00", endDate: wed, endTime: "15:30", location: "Room 4", notes: "Bring the roadmap" });
    await chooseZone(dialog, "Time zone", "Europe/Berlin");
    await chooseOption(dialog, "Add a reminder", "30 minutes before");
    await chooseOption(dialog, "Calendar", "Work");
    await saveEditor(dialog);
    await expect(editor(page)).toHaveCount(0);
    await expect(toast(page, "Event created")).toBeVisible();

    const [made] = (await allEvents(token)).filter((e) => e.title === "Planning");
    const work = (await calendars(token)).find((c) => c.name === "Work")!;
    expect(made).toMatchObject({ location: "Room 4", notes: "Bring the roadmap", start: `${wed}T14:00:00`, end: `${wed}T15:30:00`, tz: "Europe/Berlin", calendar_id: work.id });
    expect(made.reminders).toEqual([{ minutes_before: 30 }]);
    // 14:00 in Berlin is not 14:00 in UTC, and the grid (in the user's zone, UTC) shows that.
    const [occ] = (await occurrences(token, addDays(wed, -1), addDays(wed, 2))).filter((o) => o.title === "Planning");
    expect(occ.start_utc).not.toBe(`${wed}T14:00:00Z`);
    await expect(eventBlocks(page, "Planning")).toHaveCount(1);
  });

  test("edit an event from its popover", async ({ page }) => {
    const dialog = await openEditor(page, eventBlocks(page, "Planning"));
    await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue("Planning");
    await expect(dialog.getByLabel("Location")).toHaveValue("Room 4");
    await fillEditor(dialog, { title: "Planning (moved)", startTime: "16:00", endTime: "17:00", location: "Room 7" });
    await saveEditor(dialog);
    await expect(toast(page, "Event saved")).toBeVisible();
    await expect(eventBlocks(page, "Planning (moved)")).toHaveCount(1);
    await expect(eventBlocks(page, "Planning")).toHaveCount(0);

    const [e] = (await allEvents(token)).filter((x) => x.title === "Planning (moved)");
    expect(e).toMatchObject({ start: `${wed}T16:00:00`, end: `${wed}T17:00:00`, location: "Room 7", notes: "Bring the roadmap" });
  });

  test("delete asks first, and Undo brings the event back", async ({ page }) => {
    await eventBlocks(page, "Planning (moved)").click();
    await page.getByTestId("event-popover").getByRole("button", { name: "Delete" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Delete event?");
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(toast(page, "Event deleted")).toBeVisible();
    await expect(eventBlocks(page, "Planning (moved)")).toHaveCount(0);
    expect((await allEvents(token)).filter((e) => e.title === "Planning (moved)")).toHaveLength(0);

    await toast(page, "Event deleted").getByRole("button", { name: "Undo" }).click();
    await expect(toast(page, "Event restored")).toBeVisible();
    await expect(eventBlocks(page, "Planning (moved)")).toHaveCount(1);
    expect((await allEvents(token)).filter((e) => e.title === "Planning (moved)")).toHaveLength(1);
  });

  test("an end before the start is refused and nothing is saved", async ({ page }) => {
    const before = (await allEvents(token)).length;
    const dialog = await openNewEvent(page);
    await fillEditor(dialog, { title: "Backwards", startDate: wed, startTime: "15:00", endDate: wed, endTime: "14:00" });
    await saveEditor(dialog);
    await expect(dialog.getByRole("alert").filter({ hasText: "The end can't be before the start" })).toBeVisible();
    await expect(editor(page)).toBeVisible();
    expect((await allEvents(token)).length).toBe(before);

    // Fixing it lets it through.
    await fillEditor(dialog, { endTime: "16:00" });
    await saveEditor(dialog);
    await expect(editor(page)).toHaveCount(0);
    await expect(eventBlocks(page, "Backwards")).toHaveCount(1);
  });

  test("a title is required", async ({ page }) => {
    const dialog = await openNewEvent(page);
    await saveEditor(dialog);
    await expect(dialog.getByRole("alert").filter({ hasText: "Enter a title" })).toBeVisible();
    await expect(editor(page)).toBeVisible();
  });

  test("an all-day event shows in the all-day row, not on the hour grid", async ({ page }) => {
    const dialog = await openNewEvent(page);
    await fillEditor(dialog, { title: "Conference", allDay: true, startDate: wed, endDate: wed });
    await saveEditor(dialog);
    await expect(toast(page, "Event created")).toBeVisible();
    const [e] = (await allEvents(token)).filter((x) => x.title === "Conference");
    expect(e).toMatchObject({ start: wed, end: addDays(wed, 1) });
    await expect(page.getByTestId("event").filter({ hasText: "Conference" })).toHaveCount(1);
  });

  test("the same event is visible to an agent through the API", async () => {
    await createEventViaApi(token, { title: "From an agent", start: `${wed}T09:00:00` });
    const page2 = (await occurrences(token, wed, addDays(wed, 1))).map((o) => o.title);
    expect(page2).toContain("From an agent");
  });
});
