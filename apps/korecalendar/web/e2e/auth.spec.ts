import { expect, test } from "./fixtures";
import { resetApi } from "./harness/api-server";
import { API_URL } from "./harness/env";
import { freshOwner, login, OWNER } from "./helpers";

test.beforeAll(async () => {
  await resetApi();
});

test.describe.serial("authentication", () => {
  test("a fresh install has no local form: /setup leads to Kore ID sign-in", async ({ page }) => {
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    // Kore ID is the only way in; there is no email or password field.
    await expect(page.getByRole("link", { name: /Continue with Kore ID/ })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveCount(0);
    await expect(page.getByLabel("Password")).toHaveCount(0);
  });

  test("the password endpoints are gone", async ({ request }) => {
    const creds = { email: "a@example.com", password: "long enough pw" };
    for (const path of ["/api/setup", "/api/login"]) {
      const res = await request.post(`${API_URL}${path}`, { data: creds });
      expect([404, 410], `${path} should be gone`).toContain(res.status());
    }
  });

  test("a signed-in session lands on the calendar, and signing out returns to Kore ID sign-in", async ({ page }) => {
    await freshOwner();
    await login(page);
    await expect(page).toHaveURL(/\/calendar\/(week|month|day|agenda)/);
    await expect(page.getByTestId("time-grid")).toBeVisible();

    await page.goto("/");
    await page.getByRole("button", { name: /^Account/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/calendar/week");
    await expect(page).toHaveURL(/\/login/);
    // /setup is only a redirect to sign-in now.
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/login/);

    await login(page);
    await expect(page.getByTestId("time-grid")).toBeVisible();
  });

  test("an expired session returns to the login page, and back to the page afterwards", async ({ page, context }) => {
    await freshOwner();
    await login(page);
    await context.clearCookies();
    await page.goto("/calendar/month?date=2026-03-10");
    await expect(page).toHaveURL(/\/login\?next=/);
    await login(page, OWNER, "/calendar/month?date=2026-03-10");
    await expect(page).toHaveURL(/\/calendar\/month\?date=2026-03-10/);
  });
});
