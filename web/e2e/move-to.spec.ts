import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import en from "../lib/i18n/en";
import { apiAs, createFolder, createUser, loginAs, uploadFile, type CreatedUser } from "./helpers";

type Key = keyof typeof en;
function tt(key: Key, vars: Record<string, string | number> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

const list = (page: Page) => page.getByRole("listbox", { name: en["list.label"] });
const row = (page: Page, name: string) => list(page).getByRole("option", { name, exact: true });
const toast = (page: Page) => page.getByRole("status");

async function contextAction(page: Page, name: string, action: string) {
  await row(page, name).click({ button: "right" });
  await page.getByRole("menu", { name: en["list.contextMenu"] }).getByRole("menuitem", { name: action }).click();
}

async function names(api: APIRequestContext, space: "personal" | "shared", parent?: string): Promise<string[]> {
  const res = await api.get(`/api/nodes?space=${space}${parent ? `&parent=${parent}` : ""}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { name: string }[]).map((n) => n.name);
}

let stamp = 0;
// Shared-space names are seen by every test (e.g. search): keep them distinct.
const unique = (base: string) => `mv-${base}-${Date.now()}-${++stamp}`;

async function setup(page: Page, opts: { quota_bytes?: number } = {}): Promise<{ user: CreatedUser; api: APIRequestContext }> {
  const user = await createUser(opts);
  const api = await apiAs(user.email, user.password);
  await loginAs(page, user.email, user.password);
  return { user, api };
}

test("context menu: Move to Shared space, then Move to My files", async ({ page }) => {
  const { api } = await setup(page);
  const name = `${unique("report")}.txt`;
  await uploadFile(api, name, "hello");
  await page.goto("/files");

  await contextAction(page, name, en["action.moveToShared"]);
  await expect(toast(page)).toContainText(tt("move.doneOneTo", { name, dest: en["nav.shared"] }));
  await expect(row(page, name)).toHaveCount(0);
  expect(await names(api, "shared")).toContain(name);

  await page.goto("/shared");
  await expect(row(page, name)).toBeVisible();
  // Only the other space is offered.
  await row(page, name).click({ button: "right" });
  const menu = page.getByRole("menu", { name: en["list.contextMenu"] });
  await expect(menu.getByRole("menuitem", { name: en["action.moveToShared"] })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: en["action.moveToMine"] }).click();
  await expect(toast(page)).toContainText(tt("move.doneOneTo", { name, dest: en["nav.myFiles"] }));
  await expect(row(page, name)).toHaveCount(0);
  expect(await names(api, "personal")).toContain(name);
  await api.dispose();
});

test("multi-selection moves together; Undo moves them back", async ({ page }) => {
  const { api } = await setup(page);
  const a = `${unique("a")}.txt`;
  const b = `${unique("b")}.txt`;
  const folder = unique("Folder");
  await uploadFile(api, a, "1");
  await uploadFile(api, b, "2");
  await createFolder(api, folder);
  await page.goto("/files");

  await row(page, a).click();
  await row(page, b).click({ modifiers: ["ControlOrMeta"] });
  await row(page, folder).click({ modifiers: ["ControlOrMeta"] });
  await contextAction(page, b, en["action.moveToShared"]);
  await expect(toast(page)).toContainText(tt("move.doneManyTo", { count: 3, dest: en["nav.shared"] }));
  await expect(list(page).getByRole("option")).toHaveCount(0);
  const shared = await names(api, "shared");
  expect(shared).toEqual(expect.arrayContaining([a, b, folder]));

  await toast(page).getByRole("button", { name: en["toast.undo"] }).click();
  await expect(toast(page)).toContainText(en["move.undone"]);
  await expect(row(page, a)).toBeVisible();
  await expect(row(page, b)).toBeVisible();
  await expect(row(page, folder)).toBeVisible();
  expect(await names(api, "shared")).not.toContain(a);
  await api.dispose();
});

test("Move to… dialog: browse the shared space into a nested folder and move there", async ({ page }) => {
  const { api } = await setup(page);
  const team = unique("Team");
  const teamId = await createFolder(api, team, { space: "shared" });
  const subId = await createFolder(api, "Sub", { space: "shared", parent_id: teamId });
  const moving = unique("Moving");
  await createFolder(api, moving);
  const file = `${unique("brief")}.txt`;
  await uploadFile(api, file, "brief");
  await page.goto("/files");

  // Nothing selected: no toolbar button.
  const toolbarMove = page.getByRole("button", { name: en["action.moveTo"] });
  await expect(toolbarMove).toHaveCount(0);
  await row(page, file).click();
  await row(page, moving).click({ modifiers: ["ControlOrMeta"] });
  await toolbarMove.click();

  const dialog = page.getByRole("dialog", { name: tt("move.dialog.titleMany", { count: 2 }) });
  await expect(dialog).toBeVisible();
  // Starts at the current space's root: where the items are, so not a destination.
  const submit = dialog.getByRole("button", { name: en["move.dialog.submit"] });
  await expect(submit).toBeDisabled();
  await expect(dialog.getByText(en["move.dialog.alreadyHere"])).toBeVisible();
  // The moved folder itself can't be opened or chosen.
  await expect(dialog.getByRole("button", { name: tt("move.dialog.open", { name: moving }) })).toBeDisabled();

  const space = dialog.getByRole("combobox", { name: en["move.dialog.space"] });
  await space.click();
  await page.getByRole("listbox").getByRole("option", { name: en["nav.shared"] }).click();
  await dialog.getByRole("button", { name: tt("move.dialog.open", { name: team }) }).click();
  await expect(dialog.getByRole("navigation", { name: en["move.dialog.path"] })).toContainText(team);
  await dialog.getByRole("button", { name: tt("move.dialog.open", { name: "Sub" }) }).click();
  await expect(dialog.getByText(en["move.dialog.empty"])).toBeVisible();
  await expect(dialog.getByText(tt("move.dialog.here", { location: "Sub" }))).toBeVisible();
  await expect(submit).toBeEnabled();
  // The breadcrumb goes back up.
  await dialog.getByRole("navigation", { name: en["move.dialog.path"] }).getByRole("button", { name: team }).click();
  await dialog.getByRole("button", { name: tt("move.dialog.open", { name: "Sub" }) }).click();
  await submit.click();

  await expect(dialog).toBeHidden();
  await expect(toast(page)).toContainText(tt("move.doneManyTo", { count: 2, dest: "Sub" }));
  await expect(row(page, file)).toHaveCount(0);
  expect(await names(api, "shared", subId)).toEqual(expect.arrayContaining([file, moving]));
  await api.dispose();
});

test("keyboard: M opens Move to… for the selection; Escape closes it, focus returns", async ({ page }) => {
  const { api } = await setup(page);
  const file = `${unique("k")}.txt`;
  await uploadFile(api, file, "k");
  await page.goto("/files");
  const r = row(page, file);

  // No selection: M does nothing.
  await list(page).focus();
  await page.keyboard.press("m");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await r.click();
  await page.keyboard.press("m");
  const dialog = page.getByRole("dialog", { name: tt("move.dialog.titleOne", { name: file }) });
  await expect(dialog).toBeVisible();
  // Keyboard-only: choose the shared root and move.
  await dialog.getByRole("combobox", { name: en["move.dialog.space"] }).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(dialog.getByText(tt("move.dialog.here", { location: en["nav.shared"] }))).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(r).toBeFocused();

  await page.keyboard.press("M");
  await expect(dialog).toBeVisible();
  const spaceSelect = dialog.getByRole("combobox", { name: en["move.dialog.space"] });
  await spaceSelect.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  // Wait for the choice to render: focusing a still-disabled button is a no-op.
  await expect(dialog.getByText(tt("move.dialog.here", { location: en["nav.shared"] }))).toBeVisible();
  // Changing the space never pulls focus away once the folders have loaded.
  await expect(dialog.getByTestId("move-folders")).not.toHaveAttribute("aria-busy", "true");
  await expect(spaceSelect).toBeFocused();
  const submit = dialog.getByRole("button", { name: en["move.dialog.submit"] });
  await expect(submit).toBeEnabled();
  await submit.focus();
  await expect(submit).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(toast(page)).toContainText(tt("move.doneOneTo", { name: file, dest: en["nav.shared"] }));
  expect(await names(api, "shared")).toContain(file);
  await api.dispose();
});

test("a name conflict (409) says so and moves nothing", async ({ page }) => {
  const { api } = await setup(page);
  const name = `${unique("dup")}.txt`;
  await uploadFile(api, name, "mine");
  await uploadFile(api, name, "shared", { space: "shared" });
  await page.goto("/files");

  await contextAction(page, name, en["action.moveToShared"]);
  await expect(toast(page)).toContainText(en["move.error.nameTaken"]);
  await expect(toast(page).getByRole("button", { name: en["toast.undo"] })).toHaveCount(0);
  await expect(row(page, name)).toBeVisible();
  expect((await names(api, "shared")).filter((n) => n === name)).toHaveLength(1);
  expect(await names(api, "personal")).toContain(name);
  await api.dispose();
});

test("not enough quota (507) to move a shared file into My files", async ({ page }) => {
  const other = await createUser();
  const otherApi = await apiAs(other.email, other.password);
  const big = `${unique("big")}.bin`;
  await uploadFile(otherApi, big, Buffer.alloc(4096, 7), { space: "shared" });
  await otherApi.dispose();

  const { api } = await setup(page, { quota_bytes: 1024 });
  await page.goto("/shared");
  await contextAction(page, big, en["action.moveToMine"]);
  await expect(toast(page)).toContainText(en["move.error.quota"]);
  await expect(row(page, big)).toBeVisible();
  expect(await names(api, "personal")).not.toContain(big);
  await api.dispose();
});

test("a deleted item (404) is reported", async ({ page }) => {
  const { api } = await setup(page);
  const name = `${unique("gone")}.txt`;
  const id = await uploadFile(api, name, "x");
  await page.goto("/files");
  await expect(row(page, name)).toBeVisible();
  expect((await api.delete(`/api/nodes/${id}`)).status()).toBe(204);
  await contextAction(page, name, en["action.moveToShared"]);
  await expect(toast(page)).toContainText(en["move.error.notFound"]);
  await api.dispose();
});

test("partial failures say how many moved; a failed Undo is reported", async ({ page }) => {
  const { api } = await setup(page);
  const ok = `${unique("ok")}.txt`;
  const clash = `${unique("clash")}.txt`;
  await uploadFile(api, ok, "1");
  await uploadFile(api, clash, "2");
  await uploadFile(api, clash, "taken", { space: "shared" });
  await page.goto("/files");

  await row(page, ok).click();
  await row(page, clash).click({ modifiers: ["ControlOrMeta"] });
  await contextAction(page, ok, en["action.moveToShared"]);
  await expect(toast(page)).toContainText(tt("move.partial", { done: 1, count: 2, reason: en["move.error.nameTaken"] }));
  await expect(row(page, ok)).toHaveCount(0);
  await expect(row(page, clash)).toBeVisible();

  // Block the way back, then Undo: the failure is reported, nothing is lost.
  await uploadFile(api, ok, "new one in the way");
  await toast(page).getByRole("button", { name: en["toast.undo"] }).click();
  await expect(toast(page)).toContainText(tt("move.undoFailed", { count: 1, total: 1 }));
  expect(await names(api, "shared")).toContain(ok);
  await api.dispose();
});

test("after a move, focus stays in the list so arrow keys keep working", async ({ page }) => {
  const { api } = await setup(page);
  const [a, b, c] = ["a", "b", "c"].map((n) => `${unique(`focus-${n}`)}.txt`);
  for (const n of [a, b, c]) await uploadFile(api, n, n);
  await page.goto("/files");
  const selectedRow = list(page).locator('[role="option"][aria-selected="true"]');

  // Context-menu path.
  await contextAction(page, b, en["action.moveToShared"]);
  await expect(toast(page)).toContainText(tt("move.doneOneTo", { name: b, dest: en["nav.shared"] }));
  await expect(row(page, b)).toHaveCount(0);
  await expect(list(page)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, a)).toBeFocused();
  await expect(selectedRow).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await expect(row(page, c)).toBeFocused();

  // Move to… path (opened from the toolbar button).
  await page.getByRole("button", { name: en["action.moveTo"] }).click();
  const dialog = page.getByRole("dialog", { name: tt("move.dialog.titleOne", { name: c }) });
  await dialog.getByRole("combobox", { name: en["move.dialog.space"] }).click();
  await page.getByRole("listbox").getByRole("option", { name: en["nav.shared"] }).click();
  await dialog.getByRole("button", { name: en["move.dialog.submit"] }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, c)).toHaveCount(0);
  await expect(list(page)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, a)).toBeFocused();
  await expect(row(page, a)).toHaveAttribute("aria-selected", "true");
  await api.dispose();
});

test("the Move to… picker asks for folders without computing sizes", async ({ page }) => {
  const { api } = await setup(page);
  const file = `${unique("picker")}.txt`;
  await uploadFile(api, file, "p");
  await page.goto("/files");
  await row(page, file).click();
  const req = page.waitForRequest((r) => r.url().includes("/api/nodes?") && r.method() === "GET");
  await page.keyboard.press("m");
  expect(new URL((await req).url()).searchParams.get("sizes")).toBe("0");
  await page.keyboard.press("Escape");
  await api.dispose();
});

test("Move to… dialog: opening a folder moves focus to the list unless focus moved elsewhere meanwhile", async ({ page }) => {
  const { api } = await setup(page);
  const team = unique("FocusTeam");
  const teamId = await createFolder(api, team, { space: "shared" });
  await createFolder(api, "Inner", { space: "shared", parent_id: teamId });
  const file = `${unique("f")}.txt`;
  await uploadFile(api, file, "f");
  await page.goto("/files");
  await row(page, file).click();
  await page.keyboard.press("m");
  const dialog = page.getByRole("dialog", { name: tt("move.dialog.titleOne", { name: file }) });
  const space = dialog.getByRole("combobox", { name: en["move.dialog.space"] });
  await space.click();
  await page.getByRole("listbox").getByRole("option", { name: en["nav.shared"] }).click();
  const folders = dialog.getByTestId("move-folders");
  await expect(folders).not.toHaveAttribute("aria-busy", "true");

  // Folder navigation by keyboard: focus follows into the new list.
  await dialog.getByRole("button", { name: tt("move.dialog.open", { name: team }) }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: tt("move.dialog.open", { name: "Inner" }) })).toBeVisible();
  await expect(folders).toBeFocused();

  // Navigate, then move focus before the listing arrives: focus stays put.
  await page.route("**/api/nodes?*", async (route) => {
    await new Promise((r) => setTimeout(r, 400));
    await route.continue();
  });
  await dialog.getByRole("navigation", { name: en["move.dialog.path"] }).getByRole("button", { name: en["nav.shared"] }).click();
  const cancel = dialog.getByRole("button", { name: en["dialog.cancel"] });
  await cancel.focus();
  await expect(folders).not.toHaveAttribute("aria-busy", "true");
  await expect(dialog.getByRole("button", { name: tt("move.dialog.open", { name: team }) })).toBeVisible();
  await expect(cancel).toBeFocused();
  await api.dispose();
});
