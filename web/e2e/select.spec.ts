import { expect, test, type Locator, type Page } from "@playwright/test";
import en from "../lib/i18n/en";
import { ADMIN, apiAs, chooseOption, loginAs } from "./helpers";

const GiB = 1024 ** 3;
const unitLabel = en["admin.form.unit"].replace("{field}", en["admin.form.quota"]);

async function openAddUser(page: Page): Promise<Locator> {
  await loginAs(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/users");
  await page.getByRole("button", { name: en["admin.users.add"] }).click();
  const dialog = page.getByRole("dialog", { name: en["admin.add.title"] });
  await expect(dialog).toBeVisible();
  return dialog;
}

// The Select itself is kore-ui's (Radix) and tested there; this checks that
// the admin form submits what was chosen in it.
test("Select: Add user submits the chosen role and quota unit", async ({ page }) => {
  const dialog = await openAddUser(page);
  const stamp = Date.now();
  const cases = [
    { email: `sel-admin-${stamp}@kore.test`, role: "admin" as const, quota: "2", unit: "GB", bytes: 2 * GiB },
    { email: `sel-tb-${stamp}@kore.test`, role: "user" as const, quota: "1.5", unit: "TB", bytes: 1.5 * 1024 * GiB },
  ];
  for (const [i, c] of cases.entries()) {
    const d = i === 0 ? dialog : page.getByRole("dialog", { name: en["admin.add.title"] });
    if (i > 0) await page.getByRole("button", { name: en["admin.users.add"] }).click();
    await d.getByLabel(en["admin.form.email"]).fill(c.email);
    await d.getByLabel(en["admin.form.password"], { exact: true }).fill("a-long-password-1");
    if (c.role === "admin") await chooseOption(d, en["admin.form.role"], en["admin.role.admin"]);
    await expect(d.getByRole("combobox", { name: en["admin.form.role"] })).toHaveText(en[`admin.role.${c.role}`]);
    await d.getByLabel(en["admin.form.quota"], { exact: true }).fill(c.quota);
    await chooseOption(d, unitLabel, c.unit);
    await d.getByRole("button", { name: en["admin.add.submit"] }).click();
    const done = page.getByRole("dialog");
    await expect(done.getByTestId("user-created")).toBeVisible();
    await done.getByRole("button", { name: en["admin.form.done"] }).click();
    await expect(done).toBeHidden();
  }

  const admin = await apiAs(ADMIN.email, ADMIN.password);
  const users: { email: string; role: string; quota_bytes: number }[] = await (await admin.get("/api/admin/users")).json();
  await admin.dispose();
  for (const c of cases) {
    const u = users.find((x) => x.email === c.email);
    expect(u, c.email).toBeTruthy();
    expect(u!.role).toBe(c.role);
    expect(u!.quota_bytes).toBe(c.bytes);
  }
});
