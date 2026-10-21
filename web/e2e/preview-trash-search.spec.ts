import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import en from "../lib/i18n/en";
import { E2E } from "./harness/env";
import { apiAs, createFolder, createUser, loginAs, uploadFile, type CreatedUser } from "./helpers";

declare global {
  interface Window {
    __pwned?: number;
    __mdPwned?: number;
  }
}

const fill = (key: keyof typeof en, vars: Record<string, string | number>) =>
  en[key].replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

function list(page: Page, name: string = en["list.label"]) {
  return page.getByRole("listbox", { name });
}

function row(page: Page, name: string, listName?: string) {
  return list(page, listName).getByRole("option", { name, exact: true });
}

function preview(page: Page) {
  return page.getByRole("dialog");
}

/** A fresh user, an API client for them, and a logged-in page. */
async function setup(page: Page): Promise<{ user: CreatedUser; api: APIRequestContext }> {
  const user = await createUser();
  const api = await apiAs(user.email, user.password);
  await loginAs(page, user.email, user.password);
  return { user, api };
}

/** Requests the page makes to any origin other than the app itself. */
function foreignRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith(E2E.webUrl) && !r.url().startsWith("data:")) urls.push(r.url());
  });
  return urls;
}

test.describe("preview", () => {
  test("markdown renders without raw HTML, unsafe links or remote images", async ({ page }) => {
    const { api } = await setup(page);
    const md = [
      "# Quarterly notes",
      "",
      "Some **bold** text and a list:",
      "",
      "- one",
      "- two",
      "",
      "<script>window.__mdPwned = 1</script>",
      "",
      '<img src="http://127.0.0.1:18999/raw-html.png" onerror="window.__mdPwned = 2">',
      "",
      "[evil link](javascript:window.__mdPwned=3) and [data link](data:text/html,<b>x</b>) and [good link](https://example.com/page)",
      "",
      "[tab link](java&#x09;script:window.__mdPwned=4) and [ref link][evil] and [upper link](JaVaScRiPt:window.__mdPwned=6)",
      "",
      "[evil]: javascript:window.__mdPwned=5",
      "",
      "![tracking pixel](http://127.0.0.1:18999/tracker.png)",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
    ].join("\n");
    await uploadFile(api, "notes.md", md);
    await api.dispose();
    const foreign = foreignRequests(page);
    await page.goto("/files");

    await row(page, "notes.md").dblclick();
    const pane = preview(page);
    await expect(pane).toBeVisible();
    await expect(pane.getByRole("heading", { name: "notes.md" })).toBeVisible();
    const body = pane.getByTestId("markdown-view");
    await expect(body.getByRole("heading", { level: 1, name: "Quarterly notes" })).toBeVisible();
    await expect(body.locator("strong")).toHaveText("bold");
    await expect(body.locator("table td").first()).toHaveText("1");

    // Raw HTML is literal text: no elements, nothing runs.
    await expect(body).toContainText("<script>window.__mdPwned = 1</script>");
    await expect(page.locator("[data-testid=preview] script")).toHaveCount(0);
    await expect(body.locator("img")).toHaveCount(0);

    // javascript:/data: links lose their href; http(s) ones open safely in a new tab.
    await expect(body.getByRole("link", { name: "evil link" })).toHaveCount(0);
    await expect(body.getByRole("link", { name: "data link" })).toHaveCount(0);
    for (const name of ["tab link", "ref link", "upper link"]) {
      await expect(body.getByRole("link", { name })).toHaveCount(0);
      await expect(body.getByText(name)).toBeVisible();
    }
    await body.getByText("tab link").click(); // inert text, nothing runs
    await expect(body.getByText("evil link")).toBeVisible();
    await expect(body.locator('a[href^="javascript"], a[href^="data"]')).toHaveCount(0);
    const good = body.getByRole("link", { name: "good link" });
    await expect(good).toHaveAttribute("href", "https://example.com/page");
    await expect(good).toHaveAttribute("target", "_blank");
    await expect(good).toHaveAttribute("rel", "noopener noreferrer nofollow");

    // The image is a placeholder with its alt text and is never requested.
    await expect(body.locator("[data-image-placeholder]")).toContainText("tracking pixel");
    await page.waitForTimeout(300);
    expect(foreign).toEqual([]);
    expect(await page.evaluate(() => window.__mdPwned)).toBeUndefined();

    await page.keyboard.press("Escape");
    await expect(pane).toBeHidden();
  });

  test("a .txt with <script> is shown as text and never executed", async ({ page }) => {
    const { api } = await setup(page);
    await uploadFile(api, "page.txt", "before\n<script>window.__pwned=1</script>\n<img src=x onerror=\"window.__pwned=2\">\nafter\n");
    await api.dispose();
    await page.goto("/files");

    await row(page, "page.txt").click();
    await page.keyboard.press("Enter");
    const view = preview(page).getByTestId("text-view");
    await expect(view).toContainText("<script>window.__pwned=1</script>");
    await expect(view).toContainText('<img src=x onerror="window.__pwned=2">');
    await expect(view).toHaveAttribute("data-line-count", "4");
    await expect(page.locator("[data-testid=preview] script, [data-testid=preview] img")).toHaveCount(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();

    // Wrap and line-number toggles.
    const wrap = preview(page).getByRole("button", { name: en["preview.wrap"] });
    await expect(wrap).toHaveAttribute("aria-pressed", "false");
    await wrap.click();
    await expect(wrap).toHaveAttribute("aria-pressed", "true");
    const numbers = preview(page).getByRole("button", { name: en["preview.lineNumbers"] });
    await expect(numbers).toHaveAttribute("aria-pressed", "false"); // prose: off by default
    await numbers.click();
    await expect(numbers).toHaveAttribute("aria-pressed", "true");
  });

  test("double-clicking a non-previewable file downloads it without asking for a preview", async ({ page }) => {
    const { api } = await setup(page);
    // Images are previewable now; an archive is not.
    await uploadFile(api, "photos.zip", Buffer.from([0x50, 0x4b, 3, 4, 0, 1, 2, 3]));
    await api.dispose();
    const previews: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/preview") || r.url().includes("/view")) previews.push(r.url());
    });
    await page.goto("/files");

    const [download] = await Promise.all([page.waitForEvent("download"), row(page, "photos.zip").dblclick()]);
    expect(download.suggestedFilename()).toBe("photos.zip");
    expect(await download.failure()).toBeNull();
    await expect(preview(page)).toHaveCount(0);
    expect(previews).toEqual([]);
  });

  test("a file over 512 KiB shows the truncated notice", async ({ page }) => {
    const { api } = await setup(page);
    const line = "0123456789abcdef".repeat(4) + "\n"; // 65 bytes
    await uploadFile(api, "big.log", line.repeat(Math.ceil((600 * 1024) / line.length)));
    await api.dispose();
    await page.goto("/files");

    await row(page, "big.log").dblclick();
    const notice = preview(page).getByTestId("preview-truncated");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("512 KB");
    await expect(notice.getByRole("button", { name: en["preview.truncatedDownload"] })).toBeVisible();
    const lines = Number(await preview(page).getByTestId("text-view").getAttribute("data-line-count"));
    expect(lines).toBeGreaterThan(8000);
    expect(lines).toBeLessThan(8100);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      notice.getByRole("button", { name: en["preview.truncatedDownload"] }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("big.log");
  });

  test("a .txt the server rejects as binary (NUL byte) downloads instead", async ({ page }) => {
    const { api } = await setup(page);
    await uploadFile(api, "binary.txt", Buffer.from("abc\0def"));
    await api.dispose();
    await page.goto("/files");

    const [download] = await Promise.all([page.waitForEvent("download"), row(page, "binary.txt").dblclick()]);
    expect(download.suggestedFilename()).toBe("binary.txt");
    await expect(preview(page)).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "binary.txt" })).toContainText(
      fill("preview.notText", { name: "binary.txt" }),
    );
  });

  test("Space toggles quick look, Esc closes, arrows step through previewable files", async ({ page }) => {
    const { api } = await setup(page);
    await uploadFile(api, "a.txt", "first file");
    await uploadFile(api, "b.zip", "not previewable");
    await uploadFile(api, "c.go", "package main\n\nfunc main() {}\n");
    await api.dispose();
    await page.goto("/files");

    await row(page, "a.txt").click();
    await page.keyboard.press("Space");
    const pane = preview(page);
    await expect(pane.getByTestId("text-view")).toContainText("first file");
    await expect(pane).toContainText(fill("preview.position", { index: 1, count: 2 }));
    await page.keyboard.press("Space");
    await expect(pane).toBeHidden();
    await expect(row(page, "a.txt")).toBeFocused();

    await page.keyboard.press("Space");
    await expect(pane).toBeVisible();
    await page.keyboard.press("ArrowRight"); // skips b.zip
    await expect(pane.getByRole("heading", { name: "c.go" })).toBeVisible();
    await expect(pane.getByTestId("text-view")).toContainText("package main");
    await expect(pane.getByRole("button", { name: en["preview.lineNumbers"] })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(pane).toBeHidden();
    // The list follows the pane: c.go is now selected and focused.
    await expect(row(page, "c.go")).toBeFocused();
    await expect(row(page, "c.go")).toHaveAttribute("aria-selected", "true");

    // Space on a non-previewable file only selects it.
    await row(page, "b.zip").click();
    await page.keyboard.press("Space");
    await expect(row(page, "b.zip")).toHaveAttribute("aria-selected", "true");
    await expect(pane).toHaveCount(0);
  });

  test("a file deleted behind the page shows 'no longer exists'", async ({ page }) => {
    const { api } = await setup(page);
    const id = await uploadFile(api, "gone.txt", "soon gone");
    await page.goto("/files");
    await expect(row(page, "gone.txt")).toBeVisible();
    expect((await api.delete(`/api/nodes/${id}`)).status()).toBe(204);
    await api.dispose();

    await row(page, "gone.txt").dblclick();
    await expect(preview(page).getByRole("alert")).toHaveText(en["preview.notFound"]);
  });
});

test.describe("trash", () => {
  const trashList = (page: Page) => list(page, en["trash.list"]);
  const trashRow = (page: Page, name: string) => trashList(page).getByRole("option", { name, exact: true });

  test("delete, restore, delete forever, empty trash", async ({ page }) => {
    const { api } = await setup(page);
    const docs = await createFolder(api, "Docs");
    const id = await uploadFile(api, "report.txt", "q3 numbers", { parent: docs });
    await page.goto(`/files/${docs}`);

    // Move to trash from the file list.
    await row(page, "report.txt").click();
    await page.keyboard.press("Delete");
    await expect(row(page, "report.txt")).toHaveCount(0);

    await page.goto("/trash");
    await expect(page.getByRole("link", { name: en["trash.mine"] })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("trash-retention")).toHaveText(fill("trash.retention", { days: 30 }));
    await expect(trashRow(page, "report.txt")).toBeVisible();

    // Restore: toast names the folder and links to it.
    await trashRow(page, "report.txt").hover();
    await page.getByRole("button", { name: fill("trash.restoreItem", { name: "report.txt" }) }).click();
    const toast = page.getByRole("status");
    await expect(toast).toContainText(fill("trash.restoredTo", { folder: "Docs" }));
    await expect(trashRow(page, "report.txt")).toHaveCount(0);
    await expect(page.getByTestId("trash-empty")).toBeVisible();
    await toast.getByRole("button", { name: en["trash.openFolder"] }).click();
    await expect(page).toHaveURL(`/files/${docs}?select=${id}`);
    await expect(row(page, "report.txt")).toHaveAttribute("aria-selected", "true");

    // Delete forever, with a confirm dialog (Cancel first, then confirm).
    expect((await api.delete(`/api/nodes/${id}`)).status()).toBe(204);
    await page.goto("/trash");
    await trashRow(page, "report.txt").click();
    const forever = page.getByRole("button", { name: en["trash.deleteForever"], exact: true });
    await forever.click();
    const dialog = page.getByRole("alertdialog", { name: en["trash.deleteTitle"] });
    await expect(dialog).toContainText(fill("trash.deleteMessageOne", { name: "report.txt" }));
    await expect(dialog.getByRole("button", { name: en["dialog.cancel"] })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(forever).toBeFocused(); // focus returns to the opener
    await expect(trashRow(page, "report.txt")).toBeVisible();

    await forever.click();
    await dialog.getByRole("button", { name: en["trash.deleteForever"] }).click();
    await expect(dialog).toBeHidden();
    await expect(trashRow(page, "report.txt")).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText(fill("trash.deletedOne", { name: "report.txt" }));
    await expect(page.getByTestId("trash-section")).toBeFocused(); // nothing left: the section keeps focus
    expect((await page.request.get(`/api/nodes/${id}/download`)).status()).toBe(404);

    // Empty trash: the dialog states the count and that it's permanent.
    const a = await uploadFile(api, "a.txt", "a");
    const b = await createFolder(api, "Old stuff");
    expect((await api.delete(`/api/nodes/${a}`)).status()).toBe(204);
    expect((await api.delete(`/api/nodes/${b}`)).status()).toBe(204);
    await page.goto("/trash");
    await expect(trashList(page).getByRole("option")).toHaveCount(2);
    await page.getByRole("button", { name: en["trash.empty"] }).click();
    const empty = page.getByRole("alertdialog", { name: en["trash.emptyTitle"] });
    await expect(empty).toContainText(fill("trash.emptyMessageMany", { count: 2, section: en["trash.mine"] }));
    await expect(empty).toContainText("permanently");
    await empty.getByRole("button", { name: en["trash.empty"] }).click();
    await expect(page.getByTestId("trash-empty")).toBeVisible();
    await expect(page.getByRole("status")).toContainText(en["trash.emptied"]);
    await expect(page.getByTestId("trash-section")).toBeFocused();
    const left = await api.get("/api/trash?space=personal");
    expect(await left.json()).toEqual([]);
    await api.dispose();
  });

  test("multi-select restore with the list's selection model", async ({ page }) => {
    const { api } = await setup(page);
    for (const name of ["m1.txt", "m2.txt", "m3.txt", "m4.txt"]) {
      const id = await uploadFile(api, name, name);
      expect((await api.delete(`/api/nodes/${id}`)).status()).toBe(204);
    }
    await page.goto("/trash");
    const rows = trashList(page).getByRole("option");
    await expect(rows).toHaveCount(4);

    // Delete key → confirm → focus goes back to the list (rows remain).
    await rows.nth(3).click();
    await page.keyboard.press("Delete");
    const dialog = page.getByRole("alertdialog", { name: en["trash.deleteTitle"] });
    await dialog.getByRole("button", { name: en["trash.deleteForever"] }).click();
    await expect(dialog).toBeHidden();
    await expect(rows).toHaveCount(3);
    await expect(trashList(page)).toBeFocused();

    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ["Shift"] });
    await expect(page.getByText(fill("list.selectedCount", { count: 2 }))).toBeVisible();
    await page.getByRole("button", { name: en["trash.restore"], exact: true }).click();
    await expect(page.getByRole("status")).toContainText(fill("trash.restoredMany", { count: 2 }));
    await expect(rows).toHaveCount(1);
    const live = (await (await api.get("/api/nodes?space=personal")).json()) as { name: string }[];
    expect(live).toHaveLength(2);
    await api.dispose();
  });

  test("shared trash is visible to another user", async ({ page }) => {
    const owner = await createUser();
    const ownerApi = await apiAs(owner.email, owner.password);
    const name = `shared-trashed-${Date.now()}.txt`;
    const id = await uploadFile(ownerApi, name, "team file", { space: "shared" });
    expect((await ownerApi.delete(`/api/nodes/${id}`)).status()).toBe(204);
    await ownerApi.dispose();

    const other = await createUser();
    await loginAs(page, other.email, other.password);
    await page.goto("/trash");
    await expect(trashRow(page, name)).toHaveCount(0);
    await page.getByRole("link", { name: en["trash.shared"] }).click();
    await expect(page).toHaveURL("/trash?space=shared");
    await expect(page.getByRole("link", { name: en["trash.shared"] })).toHaveAttribute("aria-current", "page");
    await expect(trashRow(page, name)).toBeVisible();

    await trashRow(page, name).hover();
    await page.getByRole("button", { name: fill("trash.restoreItem", { name }) }).click();
    await expect(page.getByRole("status")).toContainText(fill("trash.restoredTo", { folder: en["nav.shared"] }));
  });
});

test("empty shared trash purges exactly the items its dialog listed", async ({ page }) => {
  const trashRow = (p: Page, name: string) => list(p, en["trash.list"]).getByRole("option", { name, exact: true });
  const a = await createUser();
  const b = await createUser();
  const aApi = await apiAs(a.email, a.password);
  const bApi = await apiAs(b.email, b.password);
  const tag = Date.now();
  const trash = async (api: APIRequestContext, name: string) => {
    const id = await uploadFile(api, name, name, { space: "shared" });
    expect((await api.delete(`/api/nodes/${id}`)).status()).toBe(204);
  };
  const sharedTrash = async () =>
    ((await (await bApi.get("/api/trash?space=shared")).json()) as { name: string }[]).map((n) => n.name);

  await trash(aApi, `listed-${tag}.txt`);
  await loginAs(page, a.email, a.password);
  await page.goto("/trash?space=shared");
  await expect(trashRow(page, `listed-${tag}.txt`)).toBeVisible();

  // Trashed after the page loaded but before the dialog opened: the dialog re-reads, so it is listed.
  await trash(bApi, `before-${tag}.txt`);
  await page.getByRole("button", { name: en["trash.empty"] }).click();
  const dialog = page.getByRole("alertdialog", { name: en["trash.emptyTitle"] });
  const count = (await sharedTrash()).length;
  await expect(dialog).toContainText(fill("trash.emptyMessageMany", { count, section: en["trash.shared"] }));
  const confirm = dialog.getByRole("button", { name: en["trash.empty"] });
  await expect(confirm).toBeEnabled();
  await expect(trashRow(page, `before-${tag}.txt`)).toBeVisible(); // the list refreshed too

  // Trashed while the dialog is open: never listed, so it must survive.
  await trash(bApi, `after-${tag}.txt`);
  await confirm.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status")).toContainText(en["trash.emptied"]);

  expect(await sharedTrash()).toEqual([`after-${tag}.txt`]);
  await expect(trashRow(page, `after-${tag}.txt`)).toBeVisible();
  await expect(trashRow(page, `listed-${tag}.txt`)).toHaveCount(0);
  await aApi.dispose();
  await bApi.dispose();
});

test.describe("search", () => {
  test("finds a Cyrillic name case-insensitively and opens its folder with the row selected", async ({ page }) => {
    const { api } = await setup(page);
    const folder = await createFolder(api, "Бухгалтерия");
    const id = await uploadFile(api, "Квартальный Отчёт.txt", "итоги", { parent: folder });
    await uploadFile(api, "unrelated.txt", "x");
    await api.dispose();
    await page.goto("/files");

    const search = page.getByRole("searchbox", { name: en["search.label"] });
    await search.fill("квартальный ОТЧЁТ");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=/);
    await expect(page.getByTestId("search-heading")).toHaveText(fill("search.resultsFor", { query: "квартальный ОТЧЁТ" }));

    const results = list(page, en["search.results"]);
    await expect(results.getByRole("option")).toHaveCount(1);
    const hit = results.getByRole("option", { name: "Квартальный Отчёт.txt" });
    await expect(hit.getByTestId("hit-path")).toHaveText(`${en["nav.myFiles"]}Бухгалтерия`);

    // Enter on a text result previews it (click the row outside its links to select).
    await hit.click({ position: { x: 4, y: 4 } });
    await expect(hit).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(preview(page).getByTestId("text-view")).toContainText("итоги");
    await page.keyboard.press("Escape");
    await expect(preview(page)).toBeHidden();

    await hit.getByRole("link", { name: "Квартальный Отчёт.txt" }).click();
    await expect(page).toHaveURL(`/files/${folder}?select=${id}`);
    const selected = row(page, "Квартальный Отчёт.txt");
    await expect(selected).toHaveAttribute("aria-selected", "true");
    await expect(selected).toBeFocused();
  });

  test("folders come first and open directly", async ({ page }) => {
    const { api } = await setup(page);
    await uploadFile(api, "plan-a.txt", "a");
    const folder = await createFolder(api, "plan folder");
    await api.dispose();
    await page.goto(`/search?q=plan`);

    const options = list(page, en["search.results"]).getByRole("option");
    await expect(options).toHaveCount(2);
    await expect(options.first()).toHaveAccessibleName("plan folder");

    // Shift-clicking a name range-selects; it doesn't navigate or open a window.
    const pages: unknown[] = [];
    page.context().on("page", (p) => pages.push(p));
    await options.first().click({ position: { x: 4, y: 4 } });
    await options.nth(1).getByRole("link", { name: "plan-a.txt" }).click({ modifiers: ["Shift"] });
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL("/search?q=plan");
    expect(pages).toEqual([]);

    await options.first().dblclick();
    await expect(page).toHaveURL(`/files/${folder}`);
  });

  test("empty, too long and no-results states; the query is shown as text", async ({ page }) => {
    await setup(page);
    await page.goto("/search");
    await expect(page.getByTestId("search-prompt")).toContainText(en["search.promptTitle"]);
    await page.goto("/search?q=%20%20");
    await expect(page.getByTestId("search-prompt")).toBeVisible();

    await page.goto(`/search?q=${"a".repeat(201)}`);
    await expect(page.getByTestId("search-error")).toHaveText(en["search.tooLong"]);

    await page.goto(`/search?q=${encodeURIComponent("<b>x</b>")}`);
    const empty = page.getByTestId("search-empty");
    await expect(empty).toContainText(fill("search.noResultsTitle", { query: "<b>x</b>" }));
    await expect(empty.locator("b")).toHaveCount(0);
  });
});
