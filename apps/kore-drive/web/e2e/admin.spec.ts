import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import en from "../lib/i18n/en";
import { E2E } from "./harness/env";
import { userExists } from "./harness/db";
import { ADMIN, apiAs, chooseOption, createFolder, createUser, loginAs, uploadFile, toasts } from "./helpers";

const GiB = 1024 ** 3;

type Key = keyof typeof en;
/** `t()` for tests: the English string with `{placeholders}` filled. */
function tt(key: Key, vars: Record<string, string | number> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

type Settings = { trash_retention_days: number; max_file_bytes: number; default_quota_bytes: number };
type UserRow = { id: string; email: string; role: string };

function row(page: Page, email: string) {
  return page.locator(`[data-testid="user-row"][data-email="${email}"]`);
}

async function usedBytes(api: APIRequestContext): Promise<number> {
  const res = await api.get("/api/me/usage");
  expect(res.status()).toBe(200);
  return (await res.json()).used_bytes;
}

async function adminLogin(page: Page) {
  await loginAs(page, ADMIN.email, ADMIN.password);
}

test("accounts come from Kore ID: the admin sets role and quota, with no add form or password", async ({ page }) => {
  const email = `edited-${Date.now()}@kore.test`;
  await createUser({ email, role: "user", quota_bytes: 0 });

  await adminLogin(page);
  await page.goto("/admin/users");
  await expect(page.getByTestId("admin-users-sso-note")).toContainText(en["admin.users.ssoNote"]);
  await expect(page.getByRole("button", { name: /add user/i })).toHaveCount(0);
  await expect(row(page, email)).toContainText("0 B of 0 B");

  await page.getByRole("button", { name: tt("admin.users.editUser", { email }) }).click();
  const dialog = page.getByRole("dialog", { name: tt("admin.edit.title", { email }) });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(en["admin.edit.ssoNote"]);
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);

  await chooseOption(dialog, en["admin.form.role"], en["admin.role.admin"]);
  await dialog.getByLabel(en["admin.form.quota"], { exact: true }).fill("3");
  await chooseOption(dialog, tt("admin.form.unit", { field: en["admin.form.quota"] }), "GB");
  await dialog.getByRole("button", { name: en["admin.edit.submit"] }).click();

  await expect(dialog).toBeHidden();
  await expect(row(page, email)).toContainText("0 B of 3 GB");
  await expect(row(page, email)).toContainText(en["admin.role.admin"]);

  // Leave no extra admin behind: the last-admin test below expects one.
  await page.getByRole("button", { name: tt("admin.users.editUser", { email }) }).click();
  const again = page.getByRole("dialog", { name: tt("admin.edit.title", { email }) });
  await chooseOption(again, en["admin.form.role"], en["admin.role.user"]);
  await again.getByRole("button", { name: en["admin.edit.submit"] }).click();
  await expect(again).toBeHidden();
  await expect(row(page, email)).toContainText(en["admin.role.user"]);
});

test("the overview shows totals and a usage bar per user", async ({ page }) => {
  const user = await createUser({ quota_bytes: 10 * 1024 * 1024 });
  const api = await apiAs(user.email, user.password);
  await uploadFile(api, "a.txt", "x".repeat(1024));
  await api.dispose();
  const admin = await apiAs(ADMIN.email, ADMIN.password);
  const usage: { email: string }[] = await (await admin.get("/api/admin/usage")).json();
  await admin.dispose();

  await adminLogin(page);
  await page.goto("/files");
  await page.getByRole("navigation", { name: en["nav.label"] }).getByRole("link", { name: en["nav.admin"] }).click();
  await expect(page).toHaveURL("/admin");
  const nav = page.getByRole("navigation", { name: en["admin.nav"] });
  await expect(nav.getByRole("link", { name: en["admin.nav.overview"] })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("user-count")).toHaveText(String(usage.length));
  await expect(page.getByTestId("usage-row")).toHaveCount(usage.length);
  const mine = page.getByTestId("usage-row").filter({ hasText: user.email });
  await expect(mine).toContainText("1 KB of 10 MB");
  await expect(mine.getByRole("meter", { name: tt("admin.usage.bar", { email: user.email }) })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await nav.getByRole("link", { name: en["admin.nav.users"] }).click();
  await expect(page).toHaveURL("/admin/users");
  await expect(nav.getByRole("link", { name: en["admin.nav.users"] })).toHaveAttribute("aria-current", "page");
});

test("non-admins get the 404 page for the admin area and 403 from the admin API", async ({ page }) => {
  const user = await createUser();
  await loginAs(page, user.email, user.password);
  for (const path of ["/admin", "/admin/users", "/admin/settings"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(page.getByRole("heading", { name: en["notFound.title"] })).toBeVisible();
    await expect(page.getByRole("navigation", { name: en["admin.nav"] })).toHaveCount(0);
  }
  for (const [method, path] of [
    ["GET", "/api/admin/users"],
    ["PATCH", `/api/admin/users/${user.id}`],
    ["DELETE", `/api/admin/users/${user.id}?files=purge`],
    ["GET", "/api/admin/settings"],
    ["PATCH", "/api/admin/settings"],
    ["GET", "/api/admin/usage"],
  ]) {
    const res = await page.request.fetch(path, { method, data: {} });
    expect(res.status(), `${method} ${path}`).toBe(403);
  }
});

test("deleting a user with files explains why; the purge keeps their shared uploads, now the admin's", async ({
  page,
}) => {
  const user = await createUser({ quota_bytes: 10 * 1024 * 1024 });
  const api = await apiAs(user.email, user.password);
  await uploadFile(api, "private-notes.txt", "only mine");
  await createFolder(api, "Private folder");
  const shared = "shared content, 1234567890";
  const sharedId = await uploadFile(api, `handed-over-${Date.now()}.txt`, shared, { space: "shared" });
  // Another user moves one of their shared uploads into their own space:
  // the file becomes theirs (uploader and quota) right away.
  const holder = await createUser();
  const holderApi = await apiAs(holder.email, holder.password);
  const movedContent = "moved by the holder";
  const movedId = await uploadFile(api, `moved-${Date.now()}.txt`, movedContent, { space: "shared" });
  expect(
    (await holderApi.patch(`/api/nodes/${movedId}`, { data: { parent_id: null, space: "personal" } })).status(),
  ).toBe(200);
  expect(await usedBytes(holderApi)).toBe(Buffer.byteLength(movedContent));
  const admin = await apiAs(ADMIN.email, ADMIN.password);
  const before = await usedBytes(admin);

  try {
    await adminLogin(page);
    await page.goto("/admin/users");
    await page.getByRole("button", { name: tt("admin.users.deleteUser", { email: user.email }) }).click();
    const confirm = page.getByRole("alertdialog", { name: tt("admin.delete.title", { email: user.email }) });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: en["admin.delete.confirm"] }).click();

    const explain = page.getByRole("alertdialog", { name: tt("admin.delete.hasFilesTitle", { email: user.email }) });
    await expect(explain).toBeVisible();
    await expect(explain).toContainText(en["admin.delete.refused"]);
    await expect(explain.getByTestId("has-files-counts").getByRole("listitem")).toHaveText([
      tt("admin.delete.personalMany", { count: 2 }),
      en["admin.delete.sharedOne"],
    ]);
    await expect(explain).toContainText(tt("admin.delete.purgeMany", { count: 2 }));
    await expect(explain).toContainText(en["admin.delete.toYouOne"]);
    await expect(explain).not.toContainText(en["admin.delete.toHoldersOne"]);
    const purge = explain.getByRole("button", { name: en["admin.delete.purgeConfirm"] });
    await expect(purge).toBeDisabled();
    const typed = explain.getByLabel(tt("admin.delete.typeEmail", { email: user.email }));
    await typed.fill("someone-else@kore.test");
    await expect(purge).toBeDisabled();
    await typed.fill(user.email);
    await purge.click();

    await expect(explain).toBeHidden();
    await expect(toasts(page).getByText(tt("admin.delete.doneWithFiles", { email: user.email })).first()).toBeVisible();
    await expect(row(page, user.email)).toHaveCount(0);

    // The account is gone (its session too); the shared file stays and counts against the admin.
    expect((await api.get("/api/auth/me")).status()).toBe(401);
    expect(userExists(user.email)).toBe(false);
    const list = await (await admin.get("/api/nodes?space=shared")).json();
    expect(list.map((n: { id: string }) => n.id)).toContain(sharedId);
    expect(await usedBytes(admin)).toBe(before + Buffer.byteLength(shared));
    // The moved file stays with the user who holds it, still on their quota.
    expect(await usedBytes(holderApi)).toBe(Buffer.byteLength(movedContent));
    const held = await (await holderApi.get("/api/nodes?space=personal")).json();
    expect(held.map((n: { id: string }) => n.id)).toContain(movedId);

    // Other specs expect an empty shared space: the admin owns the file now and removes it.
    expect((await admin.delete(`/api/nodes/${sharedId}`)).status()).toBe(204);
    expect((await admin.delete(`/api/trash/${sharedId}`)).status()).toBe(204);
    expect(await usedBytes(admin)).toBe(before);
  } finally {
    await api.dispose();
    await holderApi.dispose();
    await admin.dispose();
  }
});

test("raising a quota shows in that user's storage meter; your own role is locked", async ({ page, browser }) => {
  const user = await createUser({ quota_bytes: GiB });
  const ctx = await browser.newContext({ baseURL: E2E.webUrl });
  try {
    const p = await ctx.newPage();
    await loginAs(p, user.email, user.password);
    await p.goto("/files");
    await expect(p.getByTestId("storage-meter")).toContainText("0 B of 1 GB used");

    await adminLogin(page);
    await page.goto("/admin/users");
    await page.getByRole("button", { name: tt("admin.users.editUser", { email: user.email }) }).click();
    const dialog = page.getByRole("dialog", { name: tt("admin.edit.title", { email: user.email }) });
    const quota = dialog.getByLabel(en["admin.form.quota"], { exact: true });
    await expect(quota).toHaveValue("1");
    await quota.fill("lots");
    await dialog.getByRole("button", { name: en["admin.edit.submit"] }).click();
    await expect(dialog.getByText(en["admin.error.invalidQuota"])).toBeVisible();
    await quota.fill("2.5");
    await dialog.getByRole("button", { name: en["admin.edit.submit"] }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(tt("admin.edit.saved", { email: user.email }))).toBeVisible();
    await expect(row(page, user.email)).toContainText("0 B of 2.5 GB");

    await p.reload();
    await expect(p.getByTestId("storage-meter")).toContainText("0 B of 2.5 GB used");

    // A server-side refusal shows in the dialog: an email already in use.
    await page.getByRole("button", { name: tt("admin.users.editUser", { email: user.email }) }).click();
    await dialog.getByLabel(en["admin.form.email"]).fill(ADMIN.email.toUpperCase());
    await dialog.getByRole("button", { name: en["admin.edit.submit"] }).click();
    await expect(dialog.getByText(en["admin.error.emailInUse"])).toBeVisible();
    await dialog.getByRole("button", { name: en["dialog.cancel"] }).click();

    // Admins can't take away their own admin role from the UI.
    await page.getByRole("button", { name: tt("admin.users.editUser", { email: ADMIN.email }) }).click();
    const self = page.getByRole("dialog", { name: tt("admin.edit.title", { email: ADMIN.email }) });
    await expect(self.getByLabel(en["admin.form.role"])).toBeDisabled();
    await expect(self.getByLabel(en["admin.form.role"])).toHaveText(en["admin.role.admin"]);
    await expect(self.getByText(en["admin.form.selfRole"])).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(self).toBeHidden();
  } finally {
    await ctx.close();
  }
});

test("settings persist after reload; out-of-range values show errors", async ({ page }) => {
  const admin = await apiAs(ADMIN.email, ADMIN.password);
  const original: Settings = await (await admin.get("/api/admin/settings")).json();
  try {
    await adminLogin(page);
    await page.goto("/admin/settings");
    const form = page.getByTestId("settings-form");
    const retention = form.getByLabel(en["settings.retention"]);
    const unlimited = form.getByLabel(en["settings.unlimited"]);
    const maxSize = form.getByLabel(en["settings.maxFileSize"], { exact: true });
    const maxUnit = form.getByLabel(tt("admin.form.unit", { field: en["settings.maxFileSize"] }));
    const quota = form.getByLabel(en["settings.defaultQuota"], { exact: true });
    const quotaUnit = form.getByLabel(tt("admin.form.unit", { field: en["settings.defaultQuota"] }));
    const save = form.getByRole("button", { name: en["settings.save"] });
    const unsaved = form.getByTestId("unsaved");

    await expect(retention).toHaveValue(String(original.trash_retention_days));
    await expect(unsaved).toHaveText("");
    await expect(save).toBeDisabled();

    for (const bad of ["0", "3651", "abc", "1.5"]) {
      await retention.fill(bad);
      await expect(form.getByText(en["settings.error.retention"])).toBeVisible();
      await expect(retention).toHaveAttribute("aria-invalid", "true");
    }
    await expect(unsaved).toHaveText(en["settings.unsaved"]);
    await save.click();
    await expect(form.getByText(en["settings.fixErrors"])).toBeVisible();
    // Nothing was sent.
    expect((await (await admin.get("/api/admin/settings")).json()).trash_retention_days).toBe(
      original.trash_retention_days,
    );

    await retention.fill("45");
    await expect(form.getByText(en["settings.error.retention"])).toHaveCount(0);
    if (await unlimited.isChecked()) await unlimited.uncheck();
    await expect(maxSize).toBeEnabled();
    await maxSize.fill("-2");
    await expect(form.getByText(en["settings.error.maxFileSize"])).toBeVisible();
    await maxSize.fill("2");
    await chooseOption(form, tt("admin.form.unit", { field: en["settings.maxFileSize"] }), "GB");
    await quota.fill("-1");
    await expect(form.getByText(en["settings.error.defaultQuota"])).toBeVisible();
    await quota.fill("20");
    await chooseOption(form, tt("admin.form.unit", { field: en["settings.defaultQuota"] }), "GB");
    await save.click();
    await expect(page.getByText(en["settings.saved"])).toBeVisible();
    await expect(unsaved).toHaveText("");

    await page.reload();
    await expect(retention).toHaveValue("45");
    await expect(unlimited).not.toBeChecked();
    await expect(maxSize).toHaveValue("2");
    await expect(maxUnit).toHaveText("GB");
    await expect(quota).toHaveValue("20");
    await expect(quotaUnit).toHaveText("GB");
    const stored: Settings = await (await admin.get("/api/admin/settings")).json();
    expect(stored).toMatchObject({ trash_retention_days: 45, max_file_bytes: 2 * GiB, default_quota_bytes: 20 * GiB });

    // Back to no limit.
    await unlimited.check();
    await expect(maxSize).toBeDisabled();
    await save.click();
    await expect(unsaved).toHaveText("");
    await page.reload();
    await expect(unlimited).toBeChecked();
    expect((await (await admin.get("/api/admin/settings")).json()).max_file_bytes).toBe(0);
  } finally {
    expect((await admin.patch("/api/admin/settings", { data: original })).status()).toBe(200);
    await admin.dispose();
  }
});

test("deleting the last admin or your own account shows why it is refused", async ({ page }) => {
  const admin = await apiAs(ADMIN.email, ADMIN.password);
  const me: UserRow = await (await admin.get("/api/auth/me")).json();
  // The last-admin refusal needs the bootstrap admin to be the only admin.
  // This spec creates no lasting admins and runs on a fresh data dir, so
  // that holds; if it ever doesn't, fail loudly instead of deleting anyone.
  const all: UserRow[] = await (await admin.get("/api/admin/users")).json();
  expect(
    all.filter((u) => u.role === "admin" && u.id !== me.id).map((u) => u.email),
    "other admins exist; run admin.spec.ts on a fresh stack",
  ).toEqual([]);
  let second: { id: string } | null = null;
  try {
    await adminLogin(page);
    await page.goto("/admin/users");
    const deleteSelf = page.getByRole("button", { name: tt("admin.users.deleteUser", { email: ADMIN.email }) });
    await deleteSelf.click();
    let dialog = page.getByRole("alertdialog", { name: tt("admin.delete.title", { email: ADMIN.email }) });
    await dialog.getByRole("button", { name: en["admin.delete.confirm"] }).click();
    await expect(dialog.getByTestId("dialog-error")).toHaveText(en["admin.error.lastAdmin"]);
    await dialog.getByRole("button", { name: en["dialog.cancel"] }).click();
    await expect(dialog).toBeHidden();

    second = await createUser({ role: "admin" });
    await page.reload();
    await deleteSelf.click();
    dialog = page.getByRole("alertdialog", { name: tt("admin.delete.title", { email: ADMIN.email }) });
    await dialog.getByRole("button", { name: en["admin.delete.confirm"] }).click();
    await expect(dialog.getByTestId("dialog-error")).toHaveText(en["admin.error.cannotDeleteSelf"]);
    await page.keyboard.press("Escape");
    await expect(row(page, ADMIN.email)).toHaveCount(1);
  } finally {
    if (second) expect((await admin.delete(`/api/admin/users/${second.id}?files=purge`)).status()).toBe(204);
    await admin.dispose();
  }
});
