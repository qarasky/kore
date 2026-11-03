import { expect, test } from "./fixtures";
import { addDays, column, createEventViaApi, dayIn, eventBlocks, freshOwner, login, minutesIn, minutesWithin, occurrences, openWeek, today, weekOf, clockIn } from "./helpers";

/** Grid positions are fractions of a day; two minutes of slack covers pixel rounding. */
const SLACK = 3;

for (const zone of ["America/New_York", "Asia/Tokyo"]) {
  test.describe(`week view in ${zone}`, () => {
    let token = "";
    test.beforeAll(async () => {
      token = await freshOwner({ timezone: zone });
    });

    test("an event made in Berlin shows at its time in the user's zone, in the right column", async ({ page }) => {
      const wed = weekOf(today(zone))[2];
      await createEventViaApi(token, { title: "Berlin call", start: `${wed}T09:00:00`, end: `${wed}T10:30:00`, tz: "Europe/Berlin" });
      const [occ] = (await occurrences(token, addDays(wed, -2), addDays(wed, 3))).filter((o) => o.title === "Berlin call");
      const day = dayIn(occ.start_utc, zone);
      const label = clockIn(occ.start_utc, zone);
      expect(label).not.toBe("09:00"); // the zone really differs from Berlin

      await login(page);
      await openWeek(page, wed);
      const block = column(page, day).locator('[data-testid=event][data-title="Berlin call"]');
      await expect(block).toHaveCount(1);
      await expect(block).toHaveAttribute("aria-label", new RegExp(`, ${label}$`));
      const pos = await minutesWithin(block, column(page, day));
      expect(Math.abs(pos.top - minutesIn(occ.start_utc, zone))).toBeLessThan(SLACK);
      expect(Math.abs(pos.bottom - pos.top - 90)).toBeLessThan(SLACK);
    });
  });
}

test.describe("week view", () => {
  let token = "";
  test.beforeAll(async () => {
    token = await freshOwner({ timezone: "UTC" });
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("the now-line is only in today's column", async ({ page }) => {
    const days = weekOf(today("UTC"));
    await openWeek(page, days[0]);
    await expect(page.getByTestId("now-line")).toHaveCount(1);
    await expect(column(page, today("UTC")).getByTestId("now-line")).toHaveCount(1);
    await openWeek(page, addDays(days[0], 7));
    await expect(page.getByTestId("time-grid")).toBeVisible();
    await expect(page.getByTestId("now-line")).toHaveCount(0);
  });

  test("overlapping events sit side by side and never on top of each other", async ({ page }) => {
    const wed = weekOf(today("UTC"))[2];
    for (const [title, start, end] of [
      ["Kore review", "13:00", "14:30"],
      ["Zero sync", "13:30", "15:00"],
      ["Physio", "13:45", "14:15"],
      ["Evening", "18:00", "19:00"],
    ]) {
      await createEventViaApi(token, { title, start: `${wed}T${start}:00`, end: `${wed}T${end}:00` });
    }
    await openWeek(page, wed);
    const col = (await column(page, wed).boundingBox())!;
    const boxes = [];
    for (const title of ["Kore review", "Zero sync", "Physio"]) {
      const b = (await eventBlocks(page, title).boundingBox())!;
      expect(b, title).toBeTruthy();
      boxes.push({ title, ...b });
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        const apart = a.x + a.width <= b.x + 2 || b.x + b.width <= a.x + 2;
        expect(apart, `${a.title} and ${b.title} overlap horizontally`).toBe(true);
      }
    }
    // An event with nothing next to it takes the column.
    const evening = (await eventBlocks(page, "Evening").boundingBox())!;
    expect(evening.width).toBeGreaterThan(col.width - 8);
  });

  test("an event that spans midnight shows in both columns", async ({ page }) => {
    const [, tue, wed] = weekOf(today("UTC"));
    await createEventViaApi(token, { title: "Night shift", start: `${tue}T22:30:00`, end: `${wed}T01:30:00` });
    await openWeek(page, tue);
    const first = column(page, tue).locator('[data-testid=event][data-title="Night shift"]');
    const second = column(page, wed).locator('[data-testid=event][data-title="Night shift"]');
    await expect(first).toHaveCount(1);
    await expect(second).toHaveCount(1);
    const a = await minutesWithin(first, column(page, tue));
    const b = await minutesWithin(second, column(page, wed));
    expect(Math.abs(a.top - (22 * 60 + 30))).toBeLessThan(SLACK);
    expect(a.bottom).toBeGreaterThan(1440 - SLACK); // runs to the end of Tuesday…
    expect(b.top).toBeLessThan(SLACK); // …and continues from the start of Wednesday
    expect(Math.abs(b.bottom - 90)).toBeLessThan(SLACK);
    await expect(second).toContainText("continues");
  });
});

test.describe("the week clocks go back in New York", () => {
  let token = "";
  test.beforeAll(async () => {
    token = await freshOwner({ timezone: "America/New_York" });
  });

  test("events after the change still sit at their wall-clock time (1 Nov 2026 is 25 hours long)", async ({ page }) => {
    // Sunday 1 Nov 2026: 01:00–02:00 happens twice.
    await createEventViaApi(token, { title: "Before", start: "2026-11-01T00:15:00", end: "2026-11-01T00:45:00" });
    await createEventViaApi(token, { title: "After", start: "2026-11-01T09:00:00", end: "2026-11-01T10:00:00" });
    await createEventViaApi(token, { title: "Late", start: "2026-11-01T23:00:00", end: "2026-11-01T23:45:00" });
    await login(page);
    await openWeek(page, "2026-11-01");
    const sun = column(page, "2026-11-01");
    for (const [title, minutes] of [
      ["Before", 15],
      ["After", 9 * 60],
      ["Late", 23 * 60],
    ] as const) {
      const pos = await minutesWithin(sun.locator(`[data-testid=event][data-title="${title}"]`), sun);
      expect(Math.abs(pos.top - minutes), title).toBeLessThan(SLACK);
    }
    await expect(sun.locator('[data-testid=event][data-title="After"]')).toHaveAttribute("aria-label", /, 09:00$/);
  });
});
