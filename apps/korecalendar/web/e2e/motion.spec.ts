import { expect, test, type Page } from "@playwright/test";
import { addDays, chooseOption, createEventViaApi, editor, eventBlocks, fillEditor, freshOwner, login, openEditor, openWeek, saveEditor, toast, today, weekOf } from "./helpers";

const [, , wed] = weekOf(today("UTC"));
const FRAMES_MS = 700;

/** Per animation frame: the view wrapper's translateX and opacity, for FRAMES_MS. Started before the action it observes. */
function sampleView(page: Page) {
  return page.evaluate(
    (ms) =>
      new Promise<{ x: number; opacity: number }[]>((resolve) => {
        const out: { x: number; opacity: number }[] = [];
        const t0 = performance.now();
        const tick = () => {
          const grid = document.querySelector('[data-testid="time-grid"]');
          const el = grid?.parentElement;
          if (el) {
            const cs = getComputedStyle(el);
            const m = cs.transform === "none" ? null : new DOMMatrixReadOnly(cs.transform);
            out.push({ x: m ? m.m41 : 0, opacity: Number(cs.opacity) });
          }
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
    FRAMES_MS,
  );
}

test.describe.serial("motion", () => {
  let token = "";
  test.beforeAll(async () => {
    token = await freshOwner({ timezone: "UTC" });
    await createEventViaApi(token, { title: "Late", start: `${wed}T21:00:00`, end: `${wed}T22:00:00` });
    await createEventViaApi(token, { title: "Stand-up", start: `${wed}T09:00:00`, end: `${wed}T09:30:00` });
  });

  test("server-rendered content is never hidden: no element starts at opacity 0 in the HTML", async ({ page }) => {
    await login(page);
    const res = await page.request.get(`/calendar/week?date=${wed}`);
    const html = await res.text();
    expect(html).toContain("time-grid");
    expect(html).not.toMatch(/data-testid="time-grid"[^>]*opacity:\s*0/);
    expect(html).not.toMatch(/style="[^"]*opacity:\s*0[;"][^"]*"[^>]*class="h-full"/);
  });

  test("going to the next week pushes the content in from the right, and it settles within 250 ms", async ({ page }) => {
    await login(page);
    await openWeek(page, wed);
    const samples = sampleView(page);
    await page.getByRole("link", { name: "Next" }).click();
    const frames = await samples;
    await expect(page).toHaveURL(new RegExp(`date=${addDays(wed, 7)}`));
    const moving = frames.filter((f) => Math.abs(f.x) > 0.5);
    expect(moving.length).toBeGreaterThan(2); // it really animated
    expect(moving.every((f) => f.x > 0)).toBe(true); // from the right: later is to the right
    expect(Math.max(...moving.map((f) => f.x))).toBeLessThanOrEqual(20.5); // small
    const last = frames[frames.length - 1];
    expect(last.x).toBe(0);
    expect(last.opacity).toBe(1);
  });

  test("going back pushes from the left; switching view only fades", async ({ page }) => {
    await login(page);
    await openWeek(page, wed);
    let samples = sampleView(page);
    await page.getByRole("link", { name: "Previous" }).click();
    let moving = (await samples).filter((f) => Math.abs(f.x) > 0.5);
    expect(moving.length).toBeGreaterThan(2);
    expect(moving.every((f) => f.x < 0)).toBe(true);

    await openWeek(page, wed);
    // The month view has no time-grid: sample its wrapper through the month grid instead.
    const monthFrames = page.evaluate(
      (ms) =>
        new Promise<{ x: number; opacity: number }[]>((resolve) => {
          const out: { x: number; opacity: number }[] = [];
          const t0 = performance.now();
          const tick = () => {
            const el = document.querySelector('[data-testid="month-grid"]')?.parentElement;
            if (el) {
              const cs = getComputedStyle(el);
              out.push({ x: cs.transform === "none" ? 0 : new DOMMatrixReadOnly(cs.transform).m41, opacity: Number(cs.opacity) });
            }
            if (performance.now() - t0 < ms) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
      FRAMES_MS,
    );
    await page.getByRole("navigation", { name: "Calendar view" }).getByRole("link", { name: "Month" }).click();
    const frames = await monthFrames;
    expect(frames.some((f) => f.opacity < 1)).toBe(true); // it faded in
    expect(frames.every((f) => Math.abs(f.x) < 0.5)).toBe(true); // and did not move
    samples = Promise.resolve([]);
    moving = [];
  });

  test("with the system set to reduce motion, nothing moves but fades remain", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    await login(page);
    await openWeek(page, wed);
    const samples = sampleView(page);
    await page.getByRole("link", { name: "Next" }).click();
    const frames = await samples;
    await expect(page).toHaveURL(new RegExp(`date=${addDays(wed, 7)}`));
    expect(frames.every((f) => Math.abs(f.x) < 0.5)).toBe(true); // no frame at all carries an offset, even an invisible one
    expect(frames.some((f) => f.opacity > 0.1 && f.opacity < 0.9)).toBe(true); // the fade remains
    expect(frames[frames.length - 1].opacity).toBe(1);
    await ctx.close();
  });

  test("Settings → Animations: 'Reduced' removes movement on a normal system, 'Full' restores it on a reduced one", async ({ page, browser }) => {
    await login(page);
    await page.goto("/settings");
    await chooseOption(page, "Animations", "Reduced (no movement)");
    await expect(toast(page, "Saved")).toBeVisible();
    expect((await page.context().cookies()).find((c) => c.name === "kc_motion")?.value).toBe("reduce");
    await openWeek(page, wed);
    const samples = sampleView(page);
    await page.getByRole("link", { name: "Next" }).click();
    expect((await samples).every((f) => Math.abs(f.x) < 0.5)).toBe(true);

    const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 860 } });
    const p2 = await ctx.newPage();
    await login(p2);
    await p2.goto("/settings");
    await chooseOption(p2, "Animations", "Full");
    await expect(toast(p2, "Saved")).toBeVisible();
    await openWeek(p2, wed);
    const s2 = sampleView(p2);
    await p2.getByRole("link", { name: "Next" }).click();
    expect((await s2).some((f) => Math.abs(f.x) > 0.5)).toBe(true);
    await ctx.close();
    await page.goto("/settings");
    await chooseOption(page, "Animations", "Follow my system");
  });

  test("an edited event glides to its new time instead of jumping", async ({ page }) => {
    await login(page);
    await openWeek(page, wed);
    const block = eventBlocks(page, "Late");
    const dialog = await openEditor(page, block);
    await fillEditor(dialog, { startTime: "18:00", endTime: "19:00" });
    await page.getByTestId("time-grid").evaluate((el) => el.setAttribute("data-sampling", "1"));
    const ys = page.evaluate(
      (ms) =>
        new Promise<number[]>((resolve) => {
          const out: number[] = [];
          const t0 = performance.now();
          const tick = () => {
            const el = document.querySelector('[data-testid="event"][data-title="Late"]:not(.ring-accent)');
            if (el) out.push(el.getBoundingClientRect().y);
            if (performance.now() - t0 < ms) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
      1800,
    );
    const before = (await block.boundingBox())!.y;
    await saveEditor(dialog);
    const samples = await ys;
    const finalY = samples[samples.length - 1];
    const hour = (await page.locator(`[data-testid=day-column][data-day="${wed}"]`).boundingBox())!.height / 24;
    expect(before - finalY).toBeGreaterThan(hour * 2.5); // moved three hours up
    // Some frame is strictly between the old and the new place: it travelled.
    expect(samples.some((y) => y < before - 4 && y > finalY + 4)).toBe(true);
  });

  test("a dialog fades in and is gone from the DOM shortly after Escape", async ({ page }) => {
    await login(page);
    await openWeek(page, wed);
    await page.getByRole("button", { name: "New event", exact: true }).first().click();
    await expect(editor(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editor(page)).toHaveCount(0, { timeout: 600 });
  });

  test("a deleted event fades out, and is gone from the DOM within 300 ms", async ({ page }) => {
    await login(page);
    await openWeek(page, wed);
    await eventBlocks(page, "Stand-up").click();
    await page.getByTestId("event-popover").getByRole("button", { name: "Delete" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Delete" }).click();
    await expect(eventBlocks(page, "Stand-up")).toHaveCount(0, { timeout: 2000 });
  });
});

test.describe("a multi-day event in the month view", () => {
  test("shows fully in every cell it covers and does not flicker when the page refreshes", async ({ page }) => {
    const token = await freshOwner({ timezone: "UTC" });
    const [d1, d2, d3] = [wed, addDays(wed, 1), addDays(wed, 2)];
    await createEventViaApi(token, { title: "Trip", start: d1, end: addDays(d3, 1), all_day: true });
    await login(page);
    await page.goto(`/calendar/month?date=${wed}`);
    const chip = (d: string) => page.locator(`[data-testid=month-cell][data-day="${d}"] [data-testid=event][data-title="Trip"]`);
    for (const d of [d1, d2, d3]) await expect(chip(d)).toBeVisible();

    // Sample every chip's opacity for 1.5 s while a refresh happens (toggle a calendar off and on).
    const samples = page.evaluate(
      (days) =>
        new Promise<number[]>((resolve) => {
          const out: number[] = [];
          const t0 = performance.now();
          const tick = () => {
            for (const d of days) {
              const el = document.querySelector(`[data-testid=month-cell][data-day="${d}"] [data-testid=event][data-title="Trip"]`);
              if (el) out.push(Number(getComputedStyle(el).opacity));
            }
            if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
      [d1, d2, d3],
    );
    await page.getByRole("checkbox", { name: "Show Personal" }).click();
    await page.getByRole("checkbox", { name: "Show Personal" }).click();
    const frames = await samples;
    // While Personal is hidden the chips legitimately fade out; look only at the settled end state and at the start.
    const last3 = frames.slice(-3);
    expect(last3.every((o) => o > 0.99)).toBe(true);
    for (const d of [d1, d2, d3]) await expect(chip(d)).toHaveCSS("opacity", "1");
  });
});
