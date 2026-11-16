import { expect, test, type Page } from "@playwright/test";
import en from "../lib/i18n/en";
import { createUser, loginAs } from "./helpers";

const theme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));

test("Appearance: the theme is chosen on the account page, applies at once and survives a reload", async ({ page }) => {
  const user = await createUser();
  await loginAs(page, user.email);
  await page.goto("/account");

  // Nothing stored: the original look.
  expect(await theme(page)).toBe("color");
  const group = page.getByRole("radiogroup", { name: en["appearance.group"] });
  await expect(group).toBeVisible();

  await group.getByRole("radio", { name: new RegExp(en["appearance.light.name"]) }).click();
  await expect.poll(() => theme(page)).toBe("light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f7f8fa");

  // The init script sets the stored choice before React runs, on any page.
  await page.goto("/trash");
  await expect.poll(() => theme(page)).toBe("light");

  await page.goto("/account");
  await page.getByRole("radio", { name: new RegExp(en["appearance.dark.name"]) }).click();
  await expect.poll(() => theme(page)).toBe("dark");
  await page.reload();
  await expect.poll(() => theme(page)).toBe("dark");
});

test("Appearance: the login page follows a stored theme from the first paint", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kore-theme", "light"));
  await page.goto("/login");
  await expect.poll(() => theme(page)).toBe("light");
});
