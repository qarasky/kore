import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  addDays,
  chooseScope,
  column,
  createEventViaApi,
  editor,
  eventBlocks,
  eventsTitled,
  freshOwner,
  login,
  occurrences,
  openWeek,
  today,
  weekOf,
} from "./helpers";

const days = weekOf(today("UTC"));
const [mon, tue, wed, thu, , sat] = days;

/** Page y of `minutes` after midnight in a day column (the column is the full 24 hours). */
async function yAt(page: Page, day: string, minutes: number): Promise<number> {
  const box = (await column(page, day).boundingBox())!;
  return box.y + (minutes / 1440) * box.height;
}

async function xCenter(page: Page, day: string): Promise<number> {
  const box = (await column(page, day).boundingBox())!;
  return box.x + box.width / 2;
}

test.describe.serial("drag and keyboard", () => {
  let token = "";
  test.beforeAll(async () => {
    token = await freshOwner({ timezone: "UTC" });
    await createEventViaApi(token, { title: "Dentist", start: `${tue}T14:00:00`, end: `${tue}T15:00:00` });
    await createEventViaApi(token, { title: "Deep work", start: `${mon}T10:00:00`, end: `${mon}T12:00:00` });
    await createEventViaApi(token, { title: "Gym", start: `${wed}T16:00:00`, end: `${wed}T17:00:00`, rrule: "FREQ=DAILY" });
  });
  test.beforeEach(async ({ page }) => {
    await login(page);
    await openWeek(page, wed);
  });

  const startOf = async (title: string) => (await eventsTitled(token, title))[0].start;

  test("dragging on empty space creates an event over that range", async ({ page }) => {
    const x = await xCenter(page, sat);
    await page.mouse.move(x, (await yAt(page, sat, 13 * 60)) + 2);
    await page.mouse.down();
    await page.mouse.move(x, await yAt(page, sat, 13 * 60 + 40), { steps: 5 });
    await page.mouse.move(x, (await yAt(page, sat, 14 * 60 + 30)) + 2, { steps: 5 });
    await expect(page.getByTestId("create-ghost")).toHaveCount(1);
    await page.mouse.up();
    const dialog = editor(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Start date")).toHaveValue(sat);
    await expect(dialog.getByLabel("Start time")).toHaveValue("13:00");
    await expect(dialog.getByLabel("End date")).toHaveValue(sat);
    await expect(dialog.getByLabel("End time")).toHaveValue("14:30");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(editor(page)).toHaveCount(0);
  });

  test("a plain click on an event still opens its popover", async ({ page }) => {
    await eventBlocks(page, "Dentist").click();
    await expect(page.getByTestId("event-popover")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("event-popover")).toHaveCount(0);
  });

  test("moving an event to another day and hour", async ({ page }) => {
    const block = (await eventBlocks(page, "Dentist").boundingBox())!;
    const hour = (await column(page, tue).boundingBox())!.height / 24;
    const startY = block.y + block.height / 2;
    await page.mouse.move(block.x + block.width / 2, startY);
    await page.mouse.down();
    await page.mouse.move((await xCenter(page, wed)) - 20, startY + 10, { steps: 6 });
    await page.mouse.move((await xCenter(page, wed)) - 20, startY + hour, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => startOf("Dentist")).toBe(`${wed}T15:00:00`);
    expect((await eventsTitled(token, "Dentist"))[0].end).toBe(`${wed}T16:00:00`);
    await expect(column(page, wed).locator('[data-testid=event][data-title="Dentist"]')).toHaveCount(1);
  });

  test("resizing from the bottom edge changes only the end", async ({ page }) => {
    const hour = (await column(page, wed).boundingBox())!.height / 24;
    const handle = (await eventBlocks(page, "Dentist").locator("[data-resize-handle]").boundingBox())!;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(handle.x + handle.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, y + hour / 2, { steps: 5 });
    await page.mouse.move(handle.x + handle.width / 2, y + hour, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await eventsTitled(token, "Dentist"))[0].end).toBe(`${wed}T17:00:00`);
    expect(await startOf("Dentist")).toBe(`${wed}T15:00:00`);
  });

  test("dragging a repeating event asks which events, and 'this event' moves only that one", async ({ page }) => {
    const gym = (await column(page, wed).locator('[data-testid=event][data-title="Gym"]').boundingBox())!;
    const y = gym.y + gym.height / 2;
    await page.mouse.move(gym.x + gym.width / 2, y);
    await page.mouse.down();
    await page.mouse.move((await xCenter(page, thu)) - 10, y + 6, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByRole("heading", { name: "Move repeating event" })).toBeVisible();
    await chooseScope(page, "This event", "Move");
    await expect.poll(async () => (await occurrences(token, wed, addDays(wed, 3))).filter((o) => o.title === "Gym" && o.is_override).length).toBe(1);
    const gyms = (await occurrences(token, wed, addDays(wed, 3))).filter((o) => o.title === "Gym");
    expect(gyms.find((o) => o.is_override)!.start.startsWith(thu)).toBe(true);
    expect(gyms.filter((o) => !o.is_override).some((o) => o.start === `${thu}T16:00:00`)).toBe(true); // Thursday's own Gym is untouched
  });

  test("Escape during a drag cancels it and opens nothing", async ({ page }) => {
    const before = await startOf("Deep work");
    const box = (await eventBlocks(page, "Deep work").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 100, { steps: 6 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect(await startOf("Deep work")).toBe(before);
    await expect(page.locator("[role=dialog], [role=alertdialog]")).toHaveCount(0);
    await expect(page.getByTestId("event-popover")).toHaveCount(0);
  });

  test("keyboard: Alt+Down moves the focused event 15 minutes later per press", async ({ page }) => {
    const before = await startOf("Deep work");
    await eventBlocks(page, "Deep work").focus();
    await page.keyboard.press("Alt+ArrowDown");
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(() => startOf("Deep work"), { timeout: 10_000 }).not.toBe(before);
    expect(await startOf("Deep work")).toBe(`${mon}T10:30:00`);
  });

  test("month view: dragging a chip to another day keeps its time", async ({ page }) => {
    await page.goto(`/calendar/month?date=${tue}`);
    const cell = (d: string) => page.locator(`[data-testid=month-cell][data-day="${d}"]`);
    const chip = cell(mon).locator('[data-testid=event][data-title="Deep work"]');
    await expect(chip).toBeVisible(); // the streamed page swaps its skeleton for the grid
    const from = (await chip.boundingBox())!;
    const to = (await cell(thu).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => startOf("Deep work")).toBe(`${thu}T10:30:00`);
    expect((await eventsTitled(token, "Deep work"))[0].end).toBe(`${thu}T12:30:00`);
    await expect(cell(thu).locator('[data-testid=event][data-title="Deep work"]')).toHaveCount(1);
  });
});
