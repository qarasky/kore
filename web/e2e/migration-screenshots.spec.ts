import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import en from "../lib/i18n/en";
import { ADMIN, apiAs, createFolder, createUser, loginAs, uploadFile } from "./helpers";

/**
 * Not a test: renders the main screens into
 * docs/screenshots/kore-ui-migration/<SCREENSHOTS_PHASE>/ to compare the app
 * with kore-ui's showcase. Run with
 *   E2E_OIDC_ISSUER=https://id.example.com SCREENSHOTS=1 SCREENSHOTS_PHASE=after \
 *     npx playwright test e2e/migration-screenshots.spec.ts
 * (E2E_OIDC_ISSUER makes the harness API offer Kore ID). Skipped otherwise.
 */
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to render the migration screenshots");
test.use({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1, channel: "chromium", actionTimeout: 5_000 });
expect.configure({ timeout: 5_000 });

const PHASE = process.env.SCREENSHOTS_PHASE || "after";
const OUT = fileURLToPath(new URL(`../../docs/screenshots/kore-ui-migration/${PHASE}/`, import.meta.url));
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}${name}.png` });
const settle = (page: Page) => page.waitForTimeout(350);

/** Best effort: a step that differs between the old and the new UI must not abort the run. */
let current: Page | null = null;
async function maybe(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    if (process.env.SCREENSHOTS_DEBUG && current) await current.screenshot({ path: `/tmp/kdbg/fail-${name}.png` });
    console.log(`[screenshots] skipped ${name}: ${(e as Error).message.split("\n").slice(0, 24).join(" | ")}`);
  }
}

test("render kore-ui migration screenshots", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await mkdir(OUT, { recursive: true });
  current = page;
  const user = await createUser({ email: `anna.${Date.now()}@northwind.example`, quota_bytes: 64 << 20 });
  const api = await apiAs(user.email, user.password);
  await createFolder(api, "Clients");
  await createFolder(api, "Contracts");
  await createFolder(api, "Invoices 2026");
  await uploadFile(api, "Q3 budget.csv", "month,spend\njul,12400\naug,13950\nsep,11800\n");
  await uploadFile(api, "onboarding-checklist.md", "# Onboarding\n\n- [x] Laptop\n- [ ] First 1:1\n");
  await uploadFile(api, "Service agreement.pdf", Buffer.from("%PDF-1.4\n%fake\n"));
  await uploadFile(api, "design-assets.zip", Buffer.alloc(9 << 20, 7));

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: en["login.title"] })).toBeVisible();
  await settle(page);
  await shot(page, "01-login");

  await loginAs(page, user.email, user.password);
  await page.goto("/files");
  await expect(page.getByText("Q3 budget.csv")).toBeVisible();
  await settle(page);
  await shot(page, "02-files");

  await maybe("new menu", async () => {
    await page.getByRole("button", { name: /^(New|Create new)/ }).first().click();
    await expect(page.getByRole("menu").last()).toBeVisible();
    await settle(page);
    await shot(page, "03-new-menu");
    await page.keyboard.press("Escape");
  });

  await maybe("context menu", async () => {
    await page.getByText("Q3 budget.csv").click({ button: "right" });
    await expect(page.getByRole("menu").last()).toBeVisible();
    await settle(page);
    await shot(page, "04-context-menu");
  });

  await maybe("share dialog", async () => {
    await page.getByRole("menu").last().getByRole("menuitem", { name: en["action.shareLink"] }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: en["share.create"] }).click();
    await expect(dialog.getByRole("button", { name: en["share.copy"], exact: true })).toBeVisible();
    await settle(page);
    await shot(page, "05-share-dialog");
    // Not Escape: with a toast on screen, Escape dismisses the toast first.
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
  });

  await maybe("trash", async () => {
    await page.keyboard.press("Escape");
    await page.getByText("Contracts").click({ button: "right" });
    await page.getByRole("menu").last().getByRole("menuitem", { name: en["action.trash"] }).click();
    await expect(page.getByRole("option", { name: "Contracts" })).toBeHidden();
  });

  await maybe("account menu", async () => {
    await page.getByRole("button", { name: /^Account/ }).click();
    await expect(page.getByRole("menu").last()).toBeVisible();
    await settle(page);
    await shot(page, "07-account-menu");
    await page.keyboard.press("Escape");
  });

  await maybe("app switcher", async () => {
    await page.getByRole("button", { name: "Apps" }).click();
    await settle(page);
    await shot(page, "08-app-switcher");
    await page.keyboard.press("Escape");
  });

  await maybe("storage dialog", async () => {
    await page.getByTitle(en["storage.details"]).or(page.getByRole("button", { name: en["storage.details"] })).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await settle(page);
    await shot(page, "09-storage-dialog");
    await page.keyboard.press("Escape");
  });

  await page.goto("/account");
  await settle(page);
  await shot(page, "10-account");

  await page.goto("/trash");
  await settle(page);
  await shot(page, "11-trash");
  await maybe("confirm dialog", async () => {
    await page.getByRole("button", { name: en["trash.empty"] }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await settle(page);
    await shot(page, "06-confirm-dialog");
    await page.keyboard.press("Escape");
  });

  await page.goto("/shared-links");
  await settle(page);
  await shot(page, "12-shared-links");

  const admin = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const ap = await admin.newPage();
  await loginAs(ap, ADMIN.email, ADMIN.password);
  await ap.goto("/admin/users");
  await expect(ap.getByText(user.email)).toBeVisible();
  await settle(ap);
  await shot(ap, "13-admin-users");
  await maybe("user dialog", async () => {
    await ap.getByRole("button", { name: en["admin.users.add"] }).click();
    await expect(ap.getByRole("dialog")).toBeVisible();
    await settle(ap);
    await shot(ap, "14-admin-add-user");
    await ap.keyboard.press("Escape");
  });
  await ap.goto("/admin");
  await settle(ap);
  await shot(ap, "15-admin-overview");
  await ap.goto("/admin/settings");
  await settle(ap);
  await shot(ap, "16-admin-settings");
  await admin.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  await mp.goto("/login");
  await settle(mp);
  await shot(mp, "17-mobile-login");
  await loginAs(mp, user.email, user.password);
  await mp.goto("/files");
  await maybe("mobile list", () => expect(mp.getByText("Q3 budget.csv")).toBeVisible());
  await settle(mp);
  await shot(mp, "18-mobile-files");
  await maybe("mobile drawer", async () => {
    await mp.getByRole("button", { name: /menu|navigation/i }).first().click();
    await settle(mp);
    await shot(mp, "19-mobile-drawer");
  });
  await phone.close();
  await api.dispose();
});
