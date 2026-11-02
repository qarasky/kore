import { expect, test } from "@playwright/test";
import { startApi, stopApi } from "./harness/api-server";
import { DEAD_WEB_URL } from "./harness/env";
import { startDeadWeb, stopDeadWeb } from "./harness/web-server";
import { apiSession, createEventViaApi, editor, eventBlocks, fillEditor, freshOwner, login, openEditor, openNewEvent, openWeek, saveEditor, today, weekOf, api } from "./helpers";

const [, , wed] = weekOf(today("UTC"));

test.describe.serial("when things go wrong", () => {
  let token = "";
  test.beforeAll(async () => {
    token = await freshOwner({ timezone: "UTC" });
    await createEventViaApi(token, { title: "Dentist", start: `${wed}T14:00:00`, end: `${wed}T15:00:00` });
  });
  test.afterEach(async () => {
    await startApi().catch(() => undefined); // a test that stopped the API must not leave it down
  });
  test.afterAll(async () => {
    await stopDeadWeb();
  });

  test("a web server whose API is gone shows 'can't reach the server' and keeps you signed in", async ({ page, context }) => {
    await login(page);
    await startDeadWeb();
    await page.goto(`${DEAD_WEB_URL}/calendar/week?date=${wed}`);
    await expect(page.getByRole("heading", { name: "Can't reach the server" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    // Nothing was lost: the session cookie is still there for when the API returns.
    expect((await context.cookies()).some((c) => c.name === "korecal_session")).toBe(true);
    // No stack traces or internal addresses on the page.
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/ECONNREFUSED|19199|127\.0\.0\.1|at .*\.js/);
  });

  test("the page recovers on Retry once the API is back", async ({ page }) => {
    await login(page);
    await openWeek(page, wed);
    await expect(eventBlocks(page, "Dentist")).toHaveCount(1);
    await stopApi();
    await page.goto(`/calendar/week?date=${wed}`);
    await expect(page.getByRole("heading", { name: "Can't reach the server" })).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Can't reach the server" })).toBeVisible(); // still down
    await startApi();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("time-grid")).toBeVisible();
    await expect(eventBlocks(page, "Dentist")).toHaveCount(1);
  });

  test("saving while the API is down keeps the editor open with what was typed, and works once it is back", async ({ page }) => {
    await login(page);
    await openWeek(page, wed);
    const dialog = await openNewEvent(page);
    await fillEditor(dialog, { title: "Written offline", startDate: wed, startTime: "10:00", endDate: wed, endTime: "11:00", notes: "Do not lose me" });
    await stopApi();
    await saveEditor(dialog);
    await expect(dialog.getByRole("alert")).toContainText("Can't reach the server");
    await expect(editor(page)).toBeVisible();
    await expect(dialog.getByLabel("Notes")).toHaveValue("Do not lose me");
    await startApi();
    await saveEditor(dialog);
    await expect(editor(page)).toHaveCount(0);
    await expect(eventBlocks(page, "Written offline")).toHaveCount(1);
  });

  test("a session that ended while the editor was open says so instead of failing silently", async ({ page }) => {
    await login(page);
    await openWeek(page, wed);
    const dialog = await openEditor(page, eventBlocks(page, "Dentist"));
    // Sign the browser's session out behind its back (every session of this account).
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name === "korecal_session")!.value;
    await api(session, "POST", "/api/logout");
    await fillEditor(dialog, { title: "Dentist (changed)" });
    await saveEditor(dialog);
    await expect(dialog.getByRole("alert")).toContainText("session ended");
    await expect(editor(page)).toBeVisible();
    expect(await apiSession()).toBeTruthy(); // the account itself is fine
  });

  test("an unknown view or a malformed date is a not-found page, not a crash", async ({ page }) => {
    await login(page);
    // (The status line is 200: the page streams behind its loading skeleton before it finds out.)
    for (const path of ["/calendar/decade", "/calendar/week?date=2026-13-45", "/calendar/week?date=tomorrow"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Back to the calendar" })).toBeVisible();
    }
  });
});
