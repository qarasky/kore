import { expect, test } from "@playwright/test";
import en from "../lib/i18n/en";
import { E2E } from "./harness/env";
import { ADMIN, apiAs, createFolder, createUser, loginAs } from "./helpers";

async function fillLogin(page: import("@playwright/test").Page, email: string, password: string) {
  await page.getByLabel(en["login.email"]).fill(email);
  await page.getByLabel(en["login.password"]).fill(password);
  await page.getByRole("button", { name: en["login.submit"] }).click();
}

test("wrong password shows an inline error", async ({ page }) => {
  const user = await createUser();
  await page.goto("/login");
  await fillLogin(page, user.email, "not-the-password");

  await expect(page.getByTestId("login-error")).toHaveText(en["login.error.invalid"]);
  await expect(page).toHaveURL(/\/login/);
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "kore_session")).toBeUndefined();
});

test("correct login lands on /files", async ({ page }) => {
  await page.goto("/files");
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent("/files")}`);

  await fillLogin(page, ADMIN.email, ADMIN.password);

  await expect(page).toHaveURL("/files");
  await expect(page.getByTestId("current-user")).toContainText(ADMIN.email);
});

test("deep link while logged out returns to it after login", async ({ page }) => {
  const user = await createUser();
  const api = await apiAs(user.email, user.password);
  const id = await createFolder(api, "Deep link folder");
  await api.dispose();

  await page.goto(`/files/${id}`);
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/files/${id}`)}`);

  await fillLogin(page, user.email, user.password);

  await expect(page).toHaveURL(`/files/${id}`);
  await expect(page.getByTestId("current-folder")).toContainText("Deep link folder");
  await expect(page.getByTestId("current-user")).toContainText(user.email);
});

test("open-redirect attempt in next lands on /files", async ({ page }) => {
  for (const evil of ["//evil.com", "https://evil.com/x", "/\\evil.com"]) {
    await page.context().clearCookies();
    await page.goto(`/login?next=${encodeURIComponent(evil)}`);
    await fillLogin(page, ADMIN.email, ADMIN.password);
    await expect(page).toHaveURL(`${E2E.webUrl}/files`);
  }
});

test("logged-in user visiting /login is sent to /files", async ({ page }) => {
  await loginAs(page, ADMIN.email, ADMIN.password);
  await page.goto("/login");
  await expect(page).toHaveURL("/files");
});

test("a stale session cookie shows the login page instead of looping", async ({ page }) => {
  await page.context().addCookies([
    { name: "kore_session", value: "not-a-real-session", url: E2E.webUrl },
  ]);
  await page.goto("/files");

  await expect(page).toHaveURL(/\/login\?next=%2Ffiles&expired=1$/);
  await expect(page.getByTestId("login-error")).toHaveText(en["login.expired"]);

  await fillLogin(page, ADMIN.email, ADMIN.password);
  await expect(page).toHaveURL("/files");
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
