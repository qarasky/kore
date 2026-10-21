import { expect, test } from "@playwright/test";
import en from "../lib/i18n/en";
import { formatBytes } from "../lib/format";
import { ADMIN, apiAs, createUser, loginAs } from "./helpers";

type Disk = {
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  kore_used_bytes: number;
  quota_allocated_bytes: number;
  fs_path_label: string;
};

test("admin overview shows the disk holding the files", async ({ page }) => {
  const admin = await apiAs(ADMIN.email, ADMIN.password);
  const res = await admin.get("/api/admin/disk");
  expect(res.status()).toBe(200);
  const d: Disk = await res.json();
  await admin.dispose();
  expect(d.total_bytes).toBeGreaterThan(0);
  expect(d.used_bytes + d.free_bytes).toBeLessThanOrEqual(d.total_bytes);
  expect(d.kore_used_bytes).toBeGreaterThanOrEqual(0);

  await loginAs(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin");
  const card = page.getByRole("region", { name: en["admin.disk.title"] });
  await expect(card).toBeVisible();
  await expect(card.getByTestId("disk-total")).toHaveText(formatBytes(d.total_bytes));
  // Free space moves while tests run elsewhere on this disk: only check the shape.
  await expect(card.getByTestId("disk-free")).toHaveText(/^\d+(\.\d)? (B|KB|MB|GB|TB|PB)$/);
  await expect(card.getByTestId("disk-percent")).toHaveText(/^\d{1,3}%$/);
  const meter = card.getByRole("meter", { name: en["admin.disk.title"] });
  const now = Number(await meter.getAttribute("aria-valuenow"));
  expect(now).toBeGreaterThanOrEqual(0);
  expect(now).toBeLessThanOrEqual(100);
  const legend = card.getByTestId("disk-legend");
  for (const key of ["admin.disk.legendKore", "admin.disk.legendOther", "admin.disk.legendFree"] as const) {
    await expect(legend.getByText(en[key], { exact: true })).toBeVisible();
  }
  await expect(card.getByTestId("disk-allocated")).toContainText(formatBytes(d.quota_allocated_bytes));
  // The card comes first on the page.
  const first = page.locator("section").first();
  await expect(first).toHaveAttribute("aria-labelledby", "disk-heading");
});

test("non-admins get neither the endpoint nor the page", async ({ page }) => {
  const user = await createUser();
  const api = await apiAs(user.email, user.password);
  const res = await api.get("/api/admin/disk");
  expect(res.status()).toBe(403);
  expect(await res.json()).toEqual({ error: "forbidden" });
  await api.dispose();
  await loginAs(page, user.email, user.password);
  const nav = await page.goto("/admin");
  expect(nav?.status()).toBe(404);
});
