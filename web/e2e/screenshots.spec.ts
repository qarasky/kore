import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import en from "../lib/i18n/en";
import { ADMIN, apiAs, createFolder, createUser, loginAs, uploadFile } from "./helpers";

/**
 * Not a test: renders the screenshots for the landing page (docs/index.html)
 * into docs/screenshots/. Run with `SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts`;
 * skipped otherwise. Uses made-up users and files only.
 */
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to render the landing-page screenshots");
test.use({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1.5, channel: "chromium" });

const OUT = fileURLToPath(new URL("../../docs/screenshots/", import.meta.url));
const list = (page: Page) => page.getByRole("listbox", { name: en["list.label"] });
const row = (page: Page, name: string) => list(page).getByRole("option", { name, exact: true });

/** A soft two-tone gradient "photo", drawn by the browser so it really decodes. */
async function picture(page: Page, a: string, b: string, type: "image/jpeg" | "image/png" = "image/jpeg") {
  const url = await page.evaluate(
    ([a, b, type]) => {
      const c = document.createElement("canvas");
      c.width = 960;
      c.height = 640;
      const g = c.getContext("2d")!;
      const grad = g.createLinearGradient(0, 0, 960, 640);
      grad.addColorStop(0, a);
      grad.addColorStop(1, b);
      g.fillStyle = grad;
      g.fillRect(0, 0, 960, 640);
      g.fillStyle = "rgba(255,255,255,0.18)";
      g.beginPath();
      g.arc(700, 190, 110, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(0,0,0,0.22)";
      g.beginPath();
      g.moveTo(0, 640);
      g.lineTo(0, 430);
      g.lineTo(260, 300);
      g.lineTo(480, 440);
      g.lineTo(700, 330);
      g.lineTo(960, 470);
      g.lineTo(960, 640);
      g.fill();
      return c.toDataURL(type, 0.9);
    },
    [a, b, type] as const,
  );
  return Buffer.from(url.split(",")[1], "base64");
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}${name}.png` });

test("render landing-page screenshots", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await mkdir(OUT, { recursive: true });
  const GiB = 1 << 30;
  const anna = await createUser({ email: "anna@northwind.example", quota_bytes: 64 << 20 });
  const tom = await createUser({ email: "tom@northwind.example", quota_bytes: 50 * GiB });
  await createUser({ email: "lena@northwind.example", quota_bytes: 20 * GiB });
  await page.goto("about:blank");

  const api = await apiAs(anna.email, anna.password);
  const clients = await createFolder(api, "Clients");
  await createFolder(api, "Contracts");
  await createFolder(api, "Invoices 2026");
  await createFolder(api, "Photos");
  await createFolder(api, "Meeting notes", { parent_id: clients });
  const photos = await createFolder(api, "Campaign shots");
  const shots: [string, string, string][] = [
    ["campaign-harbour.jpg", "#f2994a", "#2d5bff"],
    ["campaign-offsite.jpg", "#56ccf2", "#6a3de8"],
    ["product-hero.jpg", "#eb5757", "#f2c94c"],
    ["brand-board.jpg", "#27ae60", "#2f80ed"],
  ];
  for (const [name, a, b] of shots) await uploadFile(api, name, await picture(page, a, b), { parent: photos });
  await uploadFile(api, "harbour-sunrise.jpg", await picture(page, "#f2994a", "#2d5bff"));
  await uploadFile(api, "team-offsite.jpg", await picture(page, "#56ccf2", "#6a3de8"));
  await uploadFile(api, "logo-concept.png", await picture(page, "#9b51e0", "#56ccf2", "image/png"));
  await uploadFile(api, "Q3 budget.csv", "month,spend\njul,12400\naug,13950\nsep,11800\n");
  await uploadFile(api, "onboarding-checklist.md", "# Onboarding\n\n- [x] Laptop and accounts\n- [x] Office tour\n- [ ] First 1:1\n\nSee the **Clients** folder for context.\n");
  await uploadFile(api, "Service agreement.pdf", Buffer.from("%PDF-1.4\n%fake\n"));
  await uploadFile(api, "kickoff-recording.mp4", randomBytes(7 << 20));
  await uploadFile(api, "design-assets.zip", randomBytes(3 << 20));
  await uploadFile(api, "podcast-intro.mp3", randomBytes(1 << 20));

  const tomApi = await apiAs(tom.email, tom.password);
  await uploadFile(tomApi, "Office rules.md", "# Office rules\n\nKeep the kitchen tidy.\n", { space: "shared" });
  await uploadFile(tomApi, "Holiday calendar 2026.csv", "date,event\n2026-01-01,New year\n", { space: "shared" });
  await uploadFile(api, "Brand guidelines.pdf", Buffer.from("%PDF-1.4\n%fake\n"), { space: "shared" });
  await uploadFile(api, "Team photo.jpg", await picture(page, "#f2c94c", "#eb5757"), { space: "shared" });
  await createFolder(api, "Templates", { space: "shared" });

  // Login screen (logged out).
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: en["login.title"] })).toBeVisible();
  await shot(page, "login");

  await loginAs(page, anna.email, anna.password);

  // My files with thumbnails.
  await page.goto("/files");
  await expect(row(page, "harbour-sunrise.jpg").locator("img")).toBeVisible();
  await expect.poll(() => row(page, "harbour-sunrise.jpg").locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => row(page, "logo-concept.png").locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await shot(page, "files");

  // Image preview.
  await row(page, "harbour-sunrise.jpg").dblclick();
  const pane = page.getByRole("dialog");
  await expect(pane.locator("img").first()).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, "preview");
  await page.keyboard.press("Escape");

  // Storage breakdown.
  await page.getByTitle(en["storage.details"]).click();
  await expect(page.getByRole("dialog", { name: en["storage.title"] })).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, "storage");
  await page.keyboard.press("Escape");

  // Share dialog.
  await row(page, "Q3 budget.csv").click({ button: "right" });
  await page.getByRole("menu", { name: en["list.contextMenu"] }).getByRole("menuitem", { name: en["action.shareLink"] }).click();
  const dialog = page.getByRole("dialog", { name: en["share.title"].replace("{name}", "Q3 budget.csv") });
  await dialog.getByRole("button", { name: en["share.create"] }).click();
  await expect(dialog.getByRole("button", { name: en["share.copy"], exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, "share");
  await page.keyboard.press("Escape");

  // Shared space with "Uploaded by".
  await page.goto("/shared");
  await expect(row(page, "Office rules.md")).toBeVisible();
  await shot(page, "shared");

  // Admin users.
  const admin = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1.5 });
  const ap = await admin.newPage();
  await loginAs(ap, ADMIN.email, ADMIN.password);
  await ap.goto("/admin/users");
  await expect(ap.getByText("lena@northwind.example")).toBeVisible();
  await shot(ap, "admin");
  await ap.goto("/admin");
  await ap.waitForTimeout(400);
  await shot(ap, "admin-overview");
  await admin.close();
  await api.dispose();
  await tomApi.dispose();
});
