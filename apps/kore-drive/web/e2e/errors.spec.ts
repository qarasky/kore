import { expect, test } from "@playwright/test";
import en from "../lib/i18n/en";
import { E2E } from "./harness/env";
import { ADMIN, loginAs } from "./helpers";

test("API outage during SSR shows the styled error page with retry", async ({ page, request }) => {
  test.skip(E2E.external, "needs the harness's API-down web instance");
  // Wait for the API-down instance (started alongside the main one). Use the
  // cookie-less `request` fixture so /login isn't redirected.
  await expect(async () => {
    expect((await request.get(`${E2E.webDownUrl}/login`)).status()).toBe(200);
  }).toPass();

  // Log in through the healthy instance; cookies are per host, not per port,
  // so the session carries over to the instance whose API is down.
  await loginAs(page, ADMIN.email, ADMIN.password);

  const res = await page.goto(`${E2E.webDownUrl}/files`);

  expect(res?.status()).toBe(500);
  await expect(page).toHaveURL(`${E2E.webDownUrl}/files`); // not bounced to login
  const errorPage = page.getByTestId("error-page");
  await expect(errorPage).toHaveAttribute("data-error-kind", "unreachable");
  await expect(page.getByRole("heading", { name: en["error.unreachableTitle"] })).toBeVisible();
  await expect(page.getByText(en["error.unreachable"])).toBeVisible();
  const retry = page.getByRole("button", { name: en["error.retry"] });
  await expect(retry).toBeVisible();

  const html = await page.content();
  for (const leak of ["ApiError", "fetch failed", "ECONNREFUSED", "node_modules", "at async"]) {
    expect(html, `page leaks "${leak}"`).not.toContain(leak);
  }

  // Retrying while the API is still down keeps showing the same styled page.
  await retry.click();
  await expect(errorPage).toHaveAttribute("data-error-kind", "unreachable");
  await expect(retry).toBeVisible();
});
