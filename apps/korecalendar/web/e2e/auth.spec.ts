import { expect, test } from "@playwright/test";
import { resetApi } from "./harness/api-server";
import { login, OWNER, setup } from "./helpers";

test.beforeAll(async () => {
  await resetApi();
});

test.describe.serial("authentication", () => {
  test("first run: create the account, land on the calendar, sign out and in again", async ({ page }) => {
    await page.goto("/");
    // No account yet: everything leads to account creation, which only works once.
    await page.goto("/setup");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await setup(page);
    await expect(page).toHaveURL(/\/calendar\/(week|month|day|agenda)/);
    await expect(page.getByTestId("time-grid")).toBeVisible();

    // A signed-in person is sent on to the calendar.
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/calendar\//);

    await page.goto("/");
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/calendar/week");
    await expect(page).toHaveURL(/\/login/);
    // Once an account exists, /setup is a door to sign-in.
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/login/);

    await login(page);
    await expect(page.getByTestId("time-grid")).toBeVisible();
  });

  test("a wrong password says so and keeps you on the form", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText(/wrong email or password/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test("an expired session returns to the login page, and back to the page afterwards", async ({ page, context }) => {
    await login(page);
    await context.clearCookies();
    await page.goto("/calendar/month?date=2026-03-10");
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password").fill(OWNER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/calendar\/month\?date=2026-03-10/);
  });

  test("repeated wrong passwords are rate limited, with a message that says when to retry", async ({ page }) => {
    // Use an address that is not the owner's so the owner's own limit is untouched by later specs.
    for (let i = 0; i < 6; i++) {
      await page.goto("/login");
      await page.getByLabel("Email").fill("nobody@korecal.test");
      await page.getByLabel("Password").fill("wrong-password-" + i);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.locator("form").getByRole("alert")).toBeVisible();
    }
    await expect(page.locator("form").getByRole("alert")).toContainText(/try again in \d+ min/i);
  });
});
