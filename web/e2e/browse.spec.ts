import { expect, test, type Page } from "@playwright/test";
import en from "../lib/i18n/en";
import { E2E } from "./harness/env";
import { apiAs, createFolder, createUser, loginAs, uploadFile, type CreatedUser } from "./helpers";

type TrashItem = { id: string; name: string };

function list(page: Page) {
  return page.getByRole("listbox", { name: en["list.label"] });
}

function row(page: Page, name: string) {
  return list(page).getByRole("option", { name, exact: true });
}

async function trashNames(page: Page): Promise<string[]> {
  const res = await page.request.get("/api/trash?space=personal");
  expect(res.status()).toBe(200);
  return ((await res.json()) as TrashItem[]).map((n) => n.name);
}

/** A fresh user with the given folders (personal root) and a logged-in page. */
async function setup(page: Page, folders: string[] = []): Promise<{ user: CreatedUser; ids: string[] }> {
  const user = await createUser();
  const api = await apiAs(user.email, user.password);
  const ids: string[] = [];
  for (const name of folders) ids.push(await createFolder(api, name));
  await api.dispose();
  await loginAs(page, user.email, user.password);
  return { user, ids };
}

test("shell: sidebar, storage meter, account menu, search box", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    // Network failures are logged too (e.g. prefetches of /trash and /search,
    // pages that arrive in task 15); only runtime/hydration errors count here.
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  const { user } = await setup(page);
  await page.goto("/files");

  const nav = page.getByRole("navigation", { name: en["nav.label"] });
  await expect(nav.getByRole("link", { name: en["nav.myFiles"] })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: en["nav.shared"] })).not.toHaveAttribute("aria-current");
  await expect(nav.getByRole("link", { name: en["nav.trash"] })).toBeVisible();
  await expect(nav.getByRole("link", { name: en["nav.admin"] })).toHaveCount(0);
  await expect(page.getByTestId("storage-meter")).toContainText(/0 B of .+ used/);
  await expect(list(page)).toBeVisible();
  await expect(page.getByText(en["empty.folder"])).toBeVisible();

  await page.getByRole("button", { name: en["account.menu"] }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toContainText(user.email);
  await expect(menu.getByRole("menuitem", { name: en["account.changePassword"] })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  const search = page.getByRole("searchbox", { name: en["search.label"] });
  await search.fill("report");
  // No hydration mismatches or runtime errors while browsing.
  expect(errors).toEqual([]);

  await search.press("Enter");
  await expect(page).toHaveURL("/search?q=report");
});

test("admins see the Admin link", async ({ page }) => {
  const admin = await createUser({ role: "admin" });
  await loginAs(page, admin.email, admin.password);
  await page.goto("/files");
  await expect(
    page.getByRole("navigation", { name: en["nav.label"] }).getByRole("link", { name: en["nav.admin"] }),
  ).toBeVisible();
});

test("sign out ends the session", async ({ page }) => {
  await setup(page);
  await page.goto("/files");
  await page.getByRole("button", { name: en["account.menu"] }).click();
  await page.getByRole("menuitem", { name: en["account.signOut"] }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/files");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("create folder via + New: it appears, persists, and shows its name", async ({ page }) => {
  await setup(page);
  await page.goto("/files");

  await page.getByRole("button", { name: en["new.button"] }).click();
  await page.getByRole("menuitem", { name: en["new.folder"] }).click();
  const input = list(page).getByRole("textbox", { name: en["rename.label"] });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(en["new.folderDefault"]);
  await input.fill("Contracts");
  await input.press("Enter");

  await expect(row(page, "Contracts")).toBeVisible();
  await expect(row(page, "Contracts")).toHaveAttribute("aria-selected", "true");
  await expect(input).toHaveCount(0);
  await page.reload();
  await expect(row(page, "Contracts")).toBeVisible();
});

test("new folder from the empty-area context menu; duplicate name shows an error", async ({ page }) => {
  await setup(page, ["Taken"]);
  await page.goto("/files");

  await page.getByTestId("list-area").click({ button: "right", position: { x: 300, y: 200 } });
  await page.getByRole("menuitem", { name: en["new.folder"] }).click();
  const input = list(page).getByRole("textbox", { name: en["rename.label"] });
  await input.fill("Taken");
  await input.press("Enter");
  await expect(page.getByText(en["rename.error.nameTaken"])).toBeVisible();
  await expect(input).toBeVisible();

  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(list(page).getByRole("option")).toHaveCount(1);
});

test("rename with F2", async ({ page }) => {
  await setup(page, ["Old name", "Other"]);
  await page.goto("/files");

  await row(page, "Old name").click();
  await page.keyboard.press("F2");
  const input = list(page).getByRole("textbox", { name: en["rename.label"] });
  await expect(input).toBeFocused();
  await input.fill("Other");
  await input.press("Enter");
  await expect(page.getByText(en["rename.error.nameTaken"])).toBeVisible();

  await input.fill("New name");
  await input.press("Enter");
  await expect(row(page, "New name")).toBeVisible();
  await expect(row(page, "Old name")).toHaveCount(0);

  // Esc cancels without saving.
  await row(page, "New name").click();
  await page.keyboard.press("F2");
  await input.fill("Discarded");
  await input.press("Escape");
  await expect(row(page, "New name")).toBeVisible();
  await page.reload();
  await expect(row(page, "New name")).toBeVisible();
});

test("delete moves to trash", async ({ page }) => {
  await setup(page, ["Doomed", "Keeper"]);
  await page.goto("/files");

  await row(page, "Doomed").click();
  await page.keyboard.press("Delete");

  await expect(row(page, "Doomed")).toHaveCount(0);
  await expect(row(page, "Keeper")).toBeVisible();
  await expect(page.getByRole("status")).toContainText(en["toast.trashedOne"].replace("{name}", "Doomed"));
  expect(await trashNames(page)).toEqual(["Doomed"]);
});

test("context menu: Move to trash", async ({ page }) => {
  await setup(page, ["Via menu"]);
  await page.goto("/files");

  await row(page, "Via menu").click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: en["action.open"] })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: en["action.rename"] })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: en["action.download"] })).toBeVisible();
  await menu.getByRole("menuitem", { name: en["action.trash"] }).click();

  await expect(row(page, "Via menu")).toHaveCount(0);
  expect(await trashNames(page)).toEqual(["Via menu"]);
});

test("undo restores a trashed item", async ({ page }) => {
  await setup(page, ["Comeback"]);
  await page.goto("/files");

  await row(page, "Comeback").click();
  await page.keyboard.press("Delete");
  await expect(row(page, "Comeback")).toHaveCount(0);
  await page.getByRole("status").getByRole("button", { name: en["toast.undo"] }).click();

  await expect(row(page, "Comeback")).toBeVisible();
  expect(await trashNames(page)).toEqual([]);
});

test("shift-select two rows then Delete trashes both", async ({ page }) => {
  await setup(page, ["A one", "B two", "C three"]);
  await page.goto("/files");

  await row(page, "A one").click();
  await row(page, "B two").click({ modifiers: ["Shift"] });
  await expect(list(page).locator('[aria-selected="true"]')).toHaveCount(2);
  await page.keyboard.press("Delete");

  await expect(row(page, "A one")).toHaveCount(0);
  await expect(row(page, "B two")).toHaveCount(0);
  await expect(row(page, "C three")).toBeVisible();
  await expect(page.getByRole("status")).toContainText(en["toast.trashedMany"].replace("{count}", "2"));
  expect((await trashNames(page)).sort()).toEqual(["A one", "B two"]);
});

test("keyboard: arrows, ctrl-click, select all, Esc, click on empty area", async ({ page }) => {
  await setup(page, ["K1", "K2", "K3"]);
  await page.goto("/files");
  const selected = list(page).locator('[aria-selected="true"]');

  await row(page, "K1").click();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, "K2")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "K2")).toBeFocused();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(selected).toHaveCount(2);
  await row(page, "K1").click({ modifiers: ["ControlOrMeta"] });
  await expect(selected).toHaveCount(3);
  await row(page, "K2").click({ modifiers: ["ControlOrMeta"] });
  await expect(selected).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(selected).toHaveCount(0);
  await row(page, "K3").focus();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(selected).toHaveCount(3);
  await page.getByTestId("list-area").click({ position: { x: 300, y: 250 } });
  await expect(selected).toHaveCount(0);
});

test("breadcrumb navigation and reload on a nested folder", async ({ page }) => {
  const user = await createUser();
  const api = await apiAs(user.email, user.password);
  const outer = await createFolder(api, "Outer");
  const inner = await createFolder(api, "Inner", { parent_id: outer });
  await createFolder(api, "Deepest", { parent_id: inner });
  await api.dispose();
  await loginAs(page, user.email, user.password);

  await page.goto("/files");
  await row(page, "Outer").dblclick();
  await expect(page).toHaveURL(`/files/${outer}`);
  await row(page, "Inner").click();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/files/${inner}`);
  await expect(row(page, "Deepest")).toBeVisible();

  const crumbs = page.getByRole("navigation", { name: en["breadcrumbs.label"] });
  await expect(crumbs).toContainText(`${en["nav.myFiles"]}OuterInner`);
  await expect(crumbs.getByText("Inner")).toHaveAttribute("aria-current", "page");

  await page.reload();
  await expect(page).toHaveURL(`/files/${inner}`);
  await expect(row(page, "Deepest")).toBeVisible();
  await expect(page.getByTestId("current-folder")).toHaveText("Inner");

  await crumbs.getByRole("link", { name: "Outer" }).click();
  await expect(page).toHaveURL(`/files/${outer}`);
  await expect(row(page, "Inner")).toBeVisible();
  await crumbs.getByRole("link", { name: en["nav.myFiles"] }).click();
  await expect(page).toHaveURL("/files");
  await expect(row(page, "Outer")).toBeVisible();
});

test("deep link to a folder while logged out returns to it after login", async ({ page }) => {
  const user = await createUser();
  const api = await apiAs(user.email, user.password);
  const id = await createFolder(api, "Linked");
  await createFolder(api, "Child of linked", { parent_id: id });
  await api.dispose();

  await page.goto(`/files/${id}`);
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/files/${id}`)}`);
  await page.getByLabel(en["login.email"]).fill(user.email);
  await page.getByLabel(en["login.password"]).fill(user.password);
  await page.getByRole("button", { name: en["login.submit"] }).click();

  await expect(page).toHaveURL(`/files/${id}`);
  await expect(row(page, "Child of linked")).toBeVisible();
});

test("another user's folder id is a 404; extra segments are a 404", async ({ page }) => {
  const owner = await createUser();
  const api = await apiAs(owner.email, owner.password);
  const id = await createFolder(api, "Private");
  await api.dispose();
  await setup(page);

  const res = await page.goto(`/files/${id}`);
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: en["notFound.title"] })).toBeVisible();
  await expect(page.getByText("Private")).toHaveCount(0);

  expect((await page.goto(`/shared/${id}`))?.status()).toBe(404);
  expect((await page.goto(`/files/${id}/extra`))?.status()).toBe(404);
});

test("shared space is visible to a second user; folder ids redirect to their section", async ({
  page,
  browser,
}) => {
  await setup(page);
  await page.goto("/shared");
  await expect(page.getByText(en["empty.shared"])).toBeVisible();
  await page.getByRole("button", { name: en["new.button"] }).click();
  await page.getByRole("menuitem", { name: en["new.folder"] }).click();
  const input = list(page).getByRole("textbox", { name: en["rename.label"] });
  const name = `Team ${Date.now()}`;
  await input.fill(name);
  await input.press("Enter");
  await expect(row(page, name)).toBeVisible();

  const other = await createUser();
  const ctx = await browser.newContext();
  const page2 = await ctx.newPage();
  await loginAs(page2, other.email, other.password);
  await page2.goto("/shared");
  await expect(
    page2.getByRole("navigation", { name: en["nav.label"] }).getByRole("link", { name: en["nav.shared"] }),
  ).toHaveAttribute("aria-current", "page");
  await row(page2, name).dblclick();
  await expect(page2).toHaveURL(/\/shared\/[^/]+$/);
  const id = page2.url().split("/").at(-1)!;
  await expect(page2.getByRole("navigation", { name: en["breadcrumbs.label"] })).toContainText(
    `${en["nav.shared"]}${name}`,
  );

  // A shared folder opened under /files lands in /shared.
  await page2.goto(`/files/${id}`);
  await expect(page2).toHaveURL(`/shared/${id}`);
  await ctx.close();
});

test("download: single selection of a folder and multi-select stream as zip", async ({ page }) => {
  await setup(page, ["Zip me", "Zip me too"]);
  await page.goto("/files");

  await row(page, "Zip me").click();
  await row(page, "Zip me too").click({ modifiers: ["Shift"] });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    row(page, "Zip me").click({ button: "right" }).then(() =>
      page.getByRole("menuitem", { name: en["action.download"] }).click(),
    ),
  ]);
  expect(download.suggestedFilename()).toBe("kore-download.zip");
  expect(await download.failure()).toBeNull();
});

test("files show size and type; Enter downloads a single file", async ({ page }) => {
  const user = await createUser();
  const api = await apiAs(user.email, user.password);
  await createFolder(api, "zz folder");
  await uploadFile(api, "notes.txt", "x".repeat(2048));
  await api.dispose();
  await loginAs(page, user.email, user.password);
  await page.goto("/files");

  // Folders first even when they sort after files by name.
  await expect(list(page).getByRole("option").first()).toHaveAccessibleName("zz folder");
  const file = row(page, "notes.txt");
  await expect(file).toContainText("2 KB");
  await expect(file).toContainText(/Today \d{1,2}:\d{2}/);
  await expect(file).toHaveAttribute("data-kind", "text");

  await file.click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
  expect(download.suggestedFilename()).toBe("notes.txt");
  expect(await download.failure()).toBeNull();
  await expect(page).toHaveURL("/files");
});

test("a failed download shows an error toast and keeps the page", async ({ page }) => {
  const user = await createUser();
  const api = await apiAs(user.email, user.password);
  const id = await uploadFile(api, "vanishing.txt", "bye");
  await loginAs(page, user.email, user.password);
  await page.goto("/files");
  await expect(row(page, "vanishing.txt")).toBeVisible();
  expect((await api.delete(`/api/nodes/${id}`)).status()).toBe(204); // gone behind the page's back
  await api.dispose();

  await row(page, "vanishing.txt").click();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText(en["toast.downloadFailed"]);
  await expect(page).toHaveURL("/files");
});

test("API outage on a folder URL shows the error page, not a 404", async ({ page, request }) => {
  await expect(async () => {
    expect((await request.get(`${E2E.webDownUrl}/login`)).status()).toBe(200);
  }).toPass();
  const { ids } = await setup(page, ["Somewhere"]);
  const res = await page.goto(`${E2E.webDownUrl}/files/${ids[0]}`);
  expect(res?.status()).toBe(500);
  await expect(page.getByTestId("error-page")).toHaveAttribute("data-error-kind", "unreachable");
});

test("a rename that fails on blur is abandoned with a toast; the list stays usable", async ({ page }) => {
  await setup(page, ["Alpha", "Beta", "Gamma"]);
  await page.goto("/files");

  await row(page, "Alpha").click();
  await page.keyboard.press("F2");
  const input = list(page).getByRole("textbox", { name: en["rename.label"] });
  await input.fill("Beta");
  await row(page, "Gamma").click(); // blur -> submit -> 409

  await expect(page.getByRole("status")).toContainText(en["rename.error.nameTaken"]);
  await expect(input).toHaveCount(0);
  await expect(row(page, "Alpha")).toBeVisible();
  await expect(row(page, "Gamma")).toHaveAttribute("aria-selected", "true");

  // Keyboard, context menu and Delete all work again.
  await page.keyboard.press("ArrowUp");
  await expect(row(page, "Beta")).toHaveAttribute("aria-selected", "true");
  await row(page, "Beta").click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await page.keyboard.press("Delete");
  await expect(row(page, "Beta")).toHaveCount(0);
  expect(await trashNames(page)).toEqual(["Beta"]);
});

test("pressing Delete twice quickly trashes once with a single Undo toast", async ({ page }) => {
  await setup(page, ["Twice", "Stays"]);
  await page.goto("/files");

  await row(page, "Twice").click();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Delete");

  await expect(row(page, "Twice")).toHaveCount(0);
  const toast = page.getByRole("status");
  await expect(toast).toContainText(en["toast.trashedOne"].replace("{name}", "Twice"));
  await expect(toast.getByRole("button", { name: en["toast.undo"] })).toBeVisible();
  await page.waitForTimeout(500); // give a stray second request time to fail
  await expect(toast).not.toContainText(en["toast.trashFailed"]);
  await expect(toast.getByRole("button", { name: en["toast.undo"] })).toBeVisible();
  await expect(row(page, "Stays")).toBeVisible();
  expect(await trashNames(page)).toEqual(["Twice"]);
});

test("Backspace does not trash; Delete typed in the rename input does not trash", async ({ page }) => {
  await setup(page, ["Safe"]);
  await page.goto("/files");

  await row(page, "Safe").click();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("F2");
  const input = list(page).getByRole("textbox", { name: en["rename.label"] });
  await expect(input).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await expect(input).toHaveValue("Saf");
  await input.press("Escape");

  await expect(row(page, "Safe")).toBeVisible();
  expect(await trashNames(page)).toEqual([]);
});

test("with several rows selected, Enter and F2 do nothing", async ({ page }) => {
  await setup(page, ["M1", "M2"]);
  await page.goto("/files");

  await row(page, "M1").click();
  await row(page, "M2").click({ modifiers: ["Shift"] });
  await page.keyboard.press("Enter");
  await page.keyboard.press("F2");

  await expect(page).toHaveURL("/files");
  await expect(list(page).getByRole("textbox")).toHaveCount(0);
  await expect(list(page).locator('[aria-selected="true"]')).toHaveCount(2);
});

test("a new folder left with the default name on blur is not created", async ({ page }) => {
  await setup(page, ["Existing"]);
  await page.goto("/files");

  await page.getByRole("button", { name: en["new.button"] }).click();
  await page.getByRole("menuitem", { name: en["new.folder"] }).click();
  const input = list(page).getByRole("textbox", { name: en["rename.label"] });
  await expect(input).toBeFocused();
  await row(page, "Existing").click(); // blur with the name untouched

  await expect(input).toHaveCount(0);
  await expect(list(page).getByRole("option")).toHaveCount(1);
  await page.reload();
  await expect(list(page).getByRole("option")).toHaveCount(1);
  await expect(row(page, en["new.folderDefault"])).toHaveCount(0);
});

test("after a context-menu action, arrow keys keep working", async ({ page }) => {
  await setup(page, ["N1", "N2", "N3"]);
  await page.goto("/files");

  await row(page, "N1").click({ button: "right" });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: en["action.download"] }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("N1.zip");
  await expect(row(page, "N1")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, "N2")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "N2")).toBeFocused();
});
