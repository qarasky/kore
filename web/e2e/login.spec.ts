import { expect, test } from "@playwright/test";
import en from "../lib/i18n/en";
import { E2E } from "./harness/env";
import { ADMIN, loginAs } from "./helpers";

test("the login page offers only Continue with Kore ID", async ({ page }) => {
  await page.goto("/files");
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent("/files")}`);

  const sso = page.getByRole("link", { name: en["login.sso"] });
  await expect(sso).toBeVisible();
  await expect(sso).toHaveAttribute("href", `/api/auth/oidc/login?next=${encodeURIComponent("/files")}`);
  // No email or password field exists anywhere on the page.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
});

test("password login, register and setup endpoints are gone", async ({ request }) => {
  for (const path of ["/api/auth/login", "/api/auth/register", "/api/auth/setup"]) {
    const res = await request.post(path, { data: { email: ADMIN.email, password: ADMIN.password } });
    expect(res.status(), path).toBe(404);
  }
  const me = await request.post("/api/me/password", {
    data: { current_password: ADMIN.password, new_password: "another-password-1" },
  });
  expect(me.status()).toBe(404);
});

test("logged-in user visiting /login is sent to /files", async ({ page }) => {
  await loginAs(page, ADMIN.email);
  await page.goto("/login");
  await expect(page).toHaveURL("/files");
});

test("a stale session cookie shows the login page instead of looping", async ({ page }) => {
  await page.context().addCookies([{ name: "kore_session", value: "not-a-real-session", url: E2E.webUrl }]);
  await page.goto("/files");

  await expect(page).toHaveURL(/\/login\?next=%2Ffiles&expired=1$/);
  await expect(page.getByTestId("login-error")).toHaveText(en["login.expired"]);
  await expect(page.getByRole("link", { name: en["login.sso"] })).toBeVisible();
});

test("redirects use relative Location headers (safe behind Caddy)", async ({ request }) => {
  // Simulate the public origin Caddy forwards; the internal URL differs.
  const behindProxy = {
    Host: "kore.example.com",
    "X-Forwarded-Host": "kore.example.com",
    "X-Forwarded-Proto": "https",
  };
  const fromProxy = await request.get("/files/abc", { headers: behindProxy, maxRedirects: 0 });
  expect(fromProxy.status()).toBe(307);
  expect(fromProxy.headers()["location"]).toBe(`/login?next=${encodeURIComponent("/files/abc")}`);

  // Server Component redirect (stale session -> requireUser -> 401).
  const fromPage = await request.get("/files", {
    headers: { ...behindProxy, Cookie: "kore_session=stale" },
    maxRedirects: 0,
  });
  expect(fromPage.status()).toBe(307);
  expect(fromPage.headers()["location"]).toBe("/login?next=%2Ffiles&expired=1");
});

test("search engines are told to stay out: robots.txt and a noindex tag on the login page", async ({ page }) => {
  const robots = await page.request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toMatch(/User-Agent: \*\s+Disallow: \//i);
  await page.goto("/login");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});
