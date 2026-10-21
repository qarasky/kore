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

/** The option the combobox currently highlights (via aria-activedescendant). */
async function activeOption(page: Page, combo: Locator): Promise<string> {
  const id = await combo.getAttribute("aria-activedescendant");
  expect(id, "aria-activedescendant").toBeTruthy();
  return (await page.locator(`[id="${id}"]`).innerText()).trim();
}

test("Select: keyboard open, arrows, Home/End, Enter selects, focus stays on the trigger", async ({ page }) => {
  const dialog = await openAddUser(page);
  const role = dialog.getByRole("combobox", { name: en["admin.form.role"] });
  await expect(role).toHaveText(en["admin.role.user"]);
  await expect(role).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("listbox")).toHaveCount(0);

  await role.focus();
  await page.keyboard.press("ArrowDown");
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  await expect(role).toHaveAttribute("aria-expanded", "true");
  await expect(role).toHaveAttribute("aria-controls", (await listbox.getAttribute("id"))!);
  // Opens on the current value, which is marked selected.
  expect(await activeOption(page, role)).toBe(en["admin.role.user"]);
  await expect(listbox.getByRole("option", { name: en["admin.role.user"] })).toHaveAttribute("aria-selected", "true");
  await expect(listbox.getByRole("option", { name: en["admin.role.admin"] })).toHaveAttribute("aria-selected", "false");

  await page.keyboard.press("ArrowDown");
  expect(await activeOption(page, role)).toBe(en["admin.role.admin"]);
  await page.keyboard.press("ArrowDown"); // no wrap at the end
  expect(await activeOption(page, role)).toBe(en["admin.role.admin"]);
  await page.keyboard.press("Home");
  expect(await activeOption(page, role)).toBe(en["admin.role.user"]);
  await page.keyboard.press("End");
  expect(await activeOption(page, role)).toBe(en["admin.role.admin"]);
  await page.keyboard.press("Enter");
  await expect(listbox).toBeHidden();
  await expect(role).toHaveText(en["admin.role.admin"]);
  await expect(role).toBeFocused();
  // The hidden input carries the value for plain form submission.
  await expect(dialog.locator('input[type="hidden"][name="role"]')).toHaveValue("admin");

  // Space opens too, and Space selects.
  await page.keyboard.press(" ");
  await expect(listbox).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press(" ");
  await expect(listbox).toBeHidden();
  await expect(role).toHaveText(en["admin.role.user"]);
});

test("Select: type-ahead, Escape keeps the value and the dialog, Tab and outside clicks close", async ({ page }) => {
  const dialog = await openAddUser(page);
  const unit = dialog.getByRole("combobox", { name: unitLabel });
  const before = (await unit.innerText()).trim();
  const other = before === "GB" ? "TB" : "GB";

  // Type-ahead on the closed trigger opens on the match.
  await unit.focus();
  await page.keyboard.press(other[0].toLowerCase());
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  expect(await activeOption(page, unit)).toBe(other);

  // Escape closes the list only: the value is unchanged, the dialog stays
  // open and focus is back on (still on) the trigger.
  await page.keyboard.press("Escape");
  await expect(listbox).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(unit).toHaveText(before);
  await expect(unit).toBeFocused();
  // A second Escape now closes the dialog as usual.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  const again = page.getByRole("dialog", { name: en["admin.add.title"] });
  await page.getByRole("button", { name: en["admin.users.add"] }).click();
  const unit2 = again.getByRole("combobox", { name: unitLabel });
  // Type-ahead while open moves the highlight; Enter picks it.
  await unit2.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press(other[0]);
  expect(await activeOption(page, unit2)).toBe(other);
  await page.keyboard.press("Enter");
  await expect(unit2).toHaveText(other);

  // Tab closes without changing anything and moves on.
  await unit2.focus();
  await page.keyboard.press("ArrowDown");
  await expect(listbox).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(listbox).toBeHidden();
  await expect(unit2).toHaveText(other);
  await expect(unit2).not.toBeFocused();

  // A click outside closes it.
  await unit2.click();
  await expect(listbox).toBeVisible();
  await again.getByRole("heading", { name: en["admin.add.title"] }).click();
  await expect(listbox).toBeHidden();
  await expect(again).toBeVisible();
});

test("Select: the popup lives in the dialog's top layer and is not clipped", async ({ page }) => {
  const dialog = await openAddUser(page);
  const role = dialog.getByRole("combobox", { name: en["admin.form.role"] });
  await role.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  expect(await listbox.evaluate((el) => el.closest("dialog") !== null)).toBe(true);
  // Fully on screen and on top (Playwright's click checks it isn't covered or inert).
  const box = (await listbox.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[role="listbox"]') !== null,
    [box.x + box.width / 2, box.y + box.height - 6],
  );
  expect(hit).toBe(true);
  await listbox.getByRole("option", { name: en["admin.role.admin"] }).click();
  await expect(role).toHaveText(en["admin.role.admin"]);
  // Focus never left the dialog.
  expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true);
});

test("Select: opens upward when there is no room below", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 420 });
  await loginAs(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/settings");
  const form = page.getByTestId("settings-form");
  const unit = form.getByRole("combobox", { name: en["admin.form.unit"].replace("{field}", en["settings.defaultQuota"]) });
  await unit.evaluate((el) => el.scrollIntoView({ block: "end" }));
  await unit.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toHaveAttribute("data-placement", "above");
  const lb = (await listbox.boundingBox())!;
  const tb = (await unit.boundingBox())!;
  expect(lb.y + lb.height).toBeLessThanOrEqual(tb.y + 1);
  await page.keyboard.press("Escape");
  await expect(listbox).toBeHidden();
});

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
    if (c.role === "admin") {
      // By keyboard.
      await d.getByRole("combobox", { name: en["admin.form.role"] }).focus();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("a");
      await page.keyboard.press("Enter");
    }
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
