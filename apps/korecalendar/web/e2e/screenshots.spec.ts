import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ROOT } from "./harness/env";
import { addDays, createEventViaApi, freshOwner, login, today, weekOf } from "./helpers";

/**
 * Screenshots of the main screens, for design reviews (not a test of behaviour).
 * Runs only with SCREENSHOTS=<name>: `E2E_OIDC=1 SCREENSHOTS=after npx playwright test screenshots`
 * writes docs/screenshots/kore-ui-migration/<name>-*.png.
 */
const NAME = process.env.SCREENSHOTS;
const DIR = join(ROOT, "docs/screenshots/kore-ui-migration");

test.skip(!NAME, "set SCREENSHOTS=<prefix> to take screenshots");

const days = weekOf(today("UTC"));
const [mon, , wed, thu, fri] = days;

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400); // let enter animations settle
  await page.screenshot({ path: join(DIR, `${NAME}-${name}.png`) });
}

test.describe.serial("screenshots", () => {
  test.beforeAll(async () => {
    mkdirSync(DIR, { recursive: true });
    const token = await freshOwner({ timezone: "UTC" });
    await createEventViaApi(token, { title: "Standup", start: `${mon}T09:30:00`, end: `${mon}T10:00:00`, rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" });
    await createEventViaApi(token, { title: "Design review", start: `${wed}T13:00:00`, end: `${wed}T14:30:00`, location: "Room 4" });
    await createEventViaApi(token, { title: "Dentist", start: `${thu}T16:00:00`, end: `${thu}T17:00:00` });
    await createEventViaApi(token, { title: "Offsite", start: `${fri}`, end: `${addDays(fri, 1)}`, all_day: true });
    await createEventViaApi(token, { title: "Lunch with Ana", start: `${addDays(mon, 8)}T12:00:00`, end: `${addDays(mon, 8)}T13:00:00` });
  });

  test("desktop", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await shot(page, "login");
    await page.getByLabel("Email").fill("owner@korecal.test");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForTimeout(800);
    await shot(page, "login-error");
    await login(page);

    await page.goto(`/calendar/week?date=${wed}`);
    await expect(page.getByTestId("time-grid")).toBeVisible();
    await page.getByTestId("time-grid").evaluate((el) => {
      const s = el.closest("[data-scroll]") ?? el.parentElement;
      s?.scrollTo?.({ top: 0 });
    });
    await shot(page, "week");

    await page.locator('[data-testid=event][data-title="Design review"]').first().click();
    await expect(page.getByTestId("event-popover")).toBeVisible();
    await shot(page, "event-popover");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "New event", exact: true }).first().click();
    await expect(page.getByRole("textbox", { name: "Title" })).toBeVisible();
    await page.getByRole("textbox", { name: "Title" }).fill("Planning");
    await shot(page, "event-editor");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: /^Account/ }).click();
    await shot(page, "account-menu");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    if (await page.locator("button[aria-label=Apps]").count()) {
      await page.locator("button[aria-label=Apps]").click();
      await shot(page, "app-switcher");
      await page.keyboard.press("Escape");
    }

    await page.locator('[data-testid=event][data-title="Standup"]').first().click();
    await page.getByTestId("event-popover").getByRole("button", { name: "Delete" }).click();
    await shot(page, "scope-dialog");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    await page.goto(`/calendar/month?date=${wed}`);
    await expect(page.getByText("Lunch with Ana").first()).toBeVisible();
    await shot(page, "month");

    await page.goto(`/calendar/agenda?date=${wed}`);
    await page.waitForLoadState("networkidle");
    await shot(page, "agenda");

    for (const [path, name] of [["/settings", "settings-general"], ["/settings/calendars", "settings-calendars"], ["/settings/tokens", "settings-tokens"]] as const) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await shot(page, name);
    }
  });

  test.describe("phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    test("mobile", async ({ page }) => {
      await page.goto("/login");
      await expect(page.getByLabel("Email")).toBeVisible();
      await shot(page, "mobile-login");
      await login(page);
      await page.goto(`/calendar/week?date=${wed}`);
      await expect(page.getByTestId("time-grid")).toBeVisible();
      await shot(page, "mobile-week");
      await page.getByRole("button", { name: /menu|navigation/i }).first().click();
      await shot(page, "mobile-drawer");
      await page.keyboard.press("Escape");
      await page.goto("/settings");
      await page.waitForLoadState("networkidle");
      await shot(page, "mobile-settings");
    });
  });
});
