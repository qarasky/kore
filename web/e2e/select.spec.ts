import { expect, test, type Locator, type Page } from "@playwright/test";
import en from "../lib/i18n/en";
import { ADMIN, apiAs, chooseOption, createUser, loginAs } from "./helpers";

const GiB = 1024 ** 3;
const unitLabel = en["admin.form.unit"].replace("{field}", en["admin.form.quota"]);
type Key = keyof typeof en;
const tt = (key: Key, vars: Record<string, string | number> = {}): string =>
  en[key].replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

async function openEditUser(page: Page, email: string): Promise<Locator> {
  await loginAs(page, ADMIN.email);
  await page.goto("/admin/users");
  await page.getByRole("button", { name: tt("admin.users.editUser", { email }) }).click();
  const dialog = page.getByRole("dialog", { name: tt("admin.edit.title", { email }) });
  await expect(dialog).toBeVisible();
  return dialog;
}

// The Select itself is kore-ui's (Radix) and tested there; this checks that
// the admin edit form submits what was chosen in it.
test("Select: editing a user submits the chosen role and quota unit", async ({ page }) => {
  const stamp = Date.now();
  const cases = [
    { email: `sel-admin-${stamp}@kore.test`, role: "admin" as const, quota: "2", unit: "GB", bytes: 2 * GiB },
    { email: `sel-tb-${stamp}@kore.test`, role: "user" as const, quota: "1.5", unit: "TB", bytes: 1.5 * 1024 * GiB },
  ];
  for (const c of cases) await createUser({ email: c.email, role: "user", quota_bytes: 0 });

  for (const c of cases) {
    const d = await openEditUser(page, c.email);
    await chooseOption(d, en["admin.form.role"], en[`admin.role.${c.role}`]);
    await expect(d.getByRole("combobox", { name: en["admin.form.role"] })).toHaveText(en[`admin.role.${c.role}`]);
    await d.getByLabel(en["admin.form.quota"], { exact: true }).fill(c.quota);
    await chooseOption(d, unitLabel, c.unit);
    await d.getByRole("button", { name: en["admin.edit.submit"] }).click();
    await expect(d).toBeHidden();
  }

  const admin = await apiAs(ADMIN.email);
  const users: { email: string; role: string; quota_bytes: number }[] = await (await admin.get("/api/admin/users")).json();
  await admin.dispose();
  for (const c of cases) {
    const u = users.find((x) => x.email === c.email);
    expect(u, c.email).toBeTruthy();
    expect(u!.role).toBe(c.role);
    expect(u!.quota_bytes).toBe(c.bytes);
  }
});
