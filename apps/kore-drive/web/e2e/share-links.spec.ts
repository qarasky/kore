import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext, type Browser, type Download, type Page } from "@playwright/test";
import en from "../lib/i18n/en";
import { ADMIN, apiAs, chooseOption, createFolder, createUser, loginAs, uploadFile } from "./helpers";

type Key = keyof typeof en;
function tt(key: Key, vars: Record<string, string | number> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

const list = (page: Page) => page.getByRole("listbox", { name: en["list.label"] });
const row = (page: Page, name: string) => list(page).getByRole("option", { name, exact: true });

async function setup(page: Page) {
  const user = await createUser();
  const api = await apiAs(user.email, user.password);
  await loginAs(page, user.email, user.password);
  return { user, api };
}

async function share(api: APIRequestContext, nodeId: string, extra: Record<string, unknown> = {}) {
  const res = await api.post("/api/shares", { data: { node_id: nodeId, ...extra } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; token: string; url_path: string };
}

/** A fresh browser context with no cookies: an anonymous visitor. */
async function anon(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

async function bytesOf(d: Download): Promise<Buffer> {
  return readFile(await d.path());
}

/** File names in a zip, from its central directory. */
function zipNames(buf: Buffer): string[] {
  const names: string[] = [];
  for (let i = 0; i + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== 0x02014b50) continue;
    const len = buf.readUInt16LE(i + 28);
    names.push(buf.subarray(i + 46, i + 46 + len).toString("utf8"));
    i += 45 + len;
  }
  return names.sort();
}

test("owner creates a link in the dialog; an anonymous visitor previews and downloads the file", async ({ page, browser, context }) => {
  const { api } = await setup(page);
  const content = "hello from a public link\nline two\n";
  await uploadFile(api, "notes.txt", content);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/files");

  await row(page, "notes.txt").click({ button: "right" });
  await page.getByRole("menu", { name: en["list.contextMenu"] }).getByRole("menuitem", { name: en["action.shareLink"] }).click();
  const dialog = page.getByRole("dialog", { name: tt("share.title", { name: "notes.txt" }) });
  await expect(dialog).toBeVisible();
  await chooseOption(dialog, en["share.expiryLabel"], en["share.expiry.30"]);
  await dialog.getByRole("button", { name: en["share.create"] }).click();
  const urlInput = dialog.getByLabel(en["share.linkLabel"]);
  await expect(urlInput).toHaveValue(/\/s\/[A-Za-z0-9_-]{43}$/);
  const url = await urlInput.inputValue();
  expect(url.startsWith(new URL(page.url()).origin)).toBe(true);
  await dialog.getByRole("button", { name: en["share.copy"], exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: en["share.copied"] })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await expect(dialog.getByTestId("share-status")).toContainText("Expires in 30 days");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // The row carries the link badge after the refresh.
  await expect(row(page, "notes.txt").getByTestId("shared-badge")).toBeVisible();

  const visitor = await anon(browser);
  await visitor.goto(url);
  await expect(visitor.getByTestId("share-name")).toHaveText("notes.txt");
  await expect(visitor.getByTestId("share-expiry")).toHaveText("Expires in 30 days");
  await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(visitor.getByTestId("share-preview")).toContainText("hello from a public link");
  const [dl] = await Promise.all([visitor.waitForEvent("download"), visitor.getByTestId("share-download").click()]);
  expect(dl.suggestedFilename()).toBe("notes.txt");
  expect((await bytesOf(dl)).toString()).toBe(content);
  // Signed in as the owner, the same page works without redirects.
  await page.goto(url);
  await expect(page.getByTestId("share-name")).toHaveText("notes.txt");
  await visitor.context().close();
  await api.dispose();
});

test("a password-protected link shows nothing until the right password is entered", async ({ page, browser }) => {
  const { api } = await setup(page);
  const id = await uploadFile(api, "secret-plan.txt", "the plan");
  const s = await share(api, id, { password: "open sesame" });
  const visitor = await anon(browser);
  await visitor.goto(s.url_path);
  const gate = visitor.getByTestId("password-gate");
  await expect(gate).toBeVisible();
  await expect(visitor.getByText("secret-plan.txt")).toHaveCount(0);
  await gate.getByLabel(en["publicShare.passwordLabel"], { exact: true }).fill("wrong one");
  await gate.getByRole("button", { name: en["publicShare.unlock"] }).click();
  await expect(gate.getByRole("alert")).toHaveText(en["publicShare.wrongPassword"]);
  await gate.getByLabel(en["publicShare.passwordLabel"], { exact: true }).fill("open sesame");
  await gate.getByRole("button", { name: en["publicShare.unlock"] }).click();
  await expect(visitor.getByTestId("share-name")).toHaveText("secret-plan.txt");
  await expect(visitor.getByTestId("share-preview")).toContainText("the plan");
  // A reload keeps it unlocked (cookie forwarded through SSR).
  await visitor.reload();
  await expect(visitor.getByTestId("share-name")).toHaveText("secret-plan.txt");
  await visitor.context().close();
  await api.dispose();
});

test("a folder link browses into a subfolder, downloads a file and the zip", async ({ page, browser }) => {
  const { api } = await setup(page);
  const root = await createFolder(api, "Project");
  const sub = await createFolder(api, "Drafts", { parent_id: root });
  await uploadFile(api, "readme.md", "# Readme", { parent: root });
  await uploadFile(api, "draft.txt", "draft text", { parent: sub });
  const outside = await uploadFile(api, "outside.txt", "nope");
  const s = await share(api, root);

  const visitor = await anon(browser);
  await visitor.goto(s.url_path);
  await expect(visitor.getByTestId("share-name")).toHaveText("Project");
  const rows = visitor.getByTestId("share-rows");
  await expect(rows.locator("li")).toHaveCount(2);
  await rows.getByRole("link", { name: "Drafts", exact: true }).click();
  await expect(visitor).toHaveURL(new RegExp(`folder=${sub}`));
  await expect(visitor.getByRole("navigation", { name: en["publicShare.breadcrumb"] })).toContainText("ProjectDrafts");
  const [dl] = await Promise.all([
    visitor.waitForEvent("download"),
    rows.getByRole("link", { name: tt("publicShare.downloadItem", { name: "draft.txt" }) }).click(),
  ]);
  expect((await bytesOf(dl)).toString()).toBe("draft text");
  // Preview in the modal through share-scoped URLs.
  await rows.getByRole("button", { name: tt("publicShare.previewItem", { name: "draft.txt" }) }).click();
  await expect(visitor.getByTestId("preview")).toContainText("draft text");
  await visitor.keyboard.press("Escape");

  await visitor.getByRole("navigation", { name: en["publicShare.breadcrumb"] }).getByRole("link", { name: "Project", exact: true }).click();
  const [zip] = await Promise.all([visitor.waitForEvent("download"), visitor.getByTestId("share-zip").click()]);
  expect(zip.suggestedFilename()).toBe("Project.zip");
  expect(zipNames(await bytesOf(zip))).toEqual(["Project/", "Project/Drafts/", "Project/Drafts/draft.txt", "Project/readme.md"]);
  // A node outside the share is not reachable through it.
  const res = await visitor.request.get(`/api/public/shares/${s.token}/download?node=${outside}`);
  expect(res.status()).toBe(404);
  await visitor.context().close();
  await api.dispose();
});

test("revoking from Shared links turns the link off; trashing the item makes it unavailable", async ({ page, browser }) => {
  const { api } = await setup(page);
  const a = await uploadFile(api, "revoke-me.txt", "a");
  const b = await uploadFile(api, "trash-me.txt", "b");
  const sa = await share(api, a);
  const sb = await share(api, b);

  await page.goto("/shared-links");
  const item = page.getByTestId("shared-links").locator('li[data-name="revoke-me.txt"]');
  await expect(item).toHaveAttribute("data-status", "active");
  await item.getByRole("button", { name: en["share.revoke"] }).click();
  await expect(item).toHaveAttribute("data-status", "revoked");

  const visitor = await anon(browser);
  await visitor.goto(sa.url_path);
  await expect(visitor.getByTestId("share-problem")).toHaveAttribute("data-problem", "revoked");
  await expect(visitor.getByRole("heading", { name: en["publicShare.revokedTitle"] })).toBeVisible();

  expect((await api.delete(`/api/nodes/${b}`)).ok()).toBe(true);
  await visitor.goto(sb.url_path);
  await expect(visitor.getByRole("heading", { name: en["publicShare.goneTitle"] })).toBeVisible();
  await expect(visitor.getByText("trash-me.txt")).toHaveCount(0);
  // An unknown token looks the same.
  await visitor.goto("/s/" + "A".repeat(43));
  await expect(visitor.getByRole("heading", { name: en["publicShare.goneTitle"] })).toBeVisible();

  // Delete (with confirmation) removes the row.
  await page.reload();
  await item.getByRole("button", { name: en["sharedLinks.delete"] }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: en["sharedLinks.delete"] }).click();
  await expect(item).toHaveCount(0);
  await visitor.context().close();
  await api.dispose();
});

test("when an admin turns links off, existing links show unavailable", async ({ page, browser }) => {
  const { api } = await setup(page);
  const id = await uploadFile(api, "while-on.txt", "x");
  const s = await share(api, id);
  const admin = await apiAs(ADMIN.email, ADMIN.password);
  try {
    expect((await admin.patch("/api/admin/settings", { data: { share_links_enabled: false } })).ok()).toBe(true);
    const visitor = await anon(browser);
    await visitor.goto(s.url_path);
    await expect(visitor.getByTestId("share-problem")).toHaveAttribute("data-problem", "disabled");
    await expect(visitor.getByRole("heading", { name: en["publicShare.goneTitle"] })).toBeVisible();
    await visitor.context().close();
    // The owner's dialog says so instead of offering a new link.
    await page.goto("/files");
    await row(page, "while-on.txt").click();
    await page.getByRole("button", { name: en["action.shareLink"] }).click();
    // An active link still exists, so the dialog shows it.
    await expect(page.getByRole("dialog").getByLabel(en["share.linkLabel"])).toHaveValue(new RegExp(s.token));
  } finally {
    expect((await admin.patch("/api/admin/settings", { data: { share_links_enabled: true } })).ok()).toBe(true);
    await admin.dispose();
    await api.dispose();
  }
  await page.goto(s.url_path);
  await expect(page.getByTestId("share-name")).toHaveText("while-on.txt");
});

test("admin settings: public share links card toggles the feature and sets the default expiry", async ({ page }) => {
  await loginAs(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/settings");
  const card = page.getByTestId("share-settings");
  await expect(card.getByRole("checkbox", { name: en["settings.shareEnabled"] })).toBeChecked();
  await chooseOption(card, en["settings.shareDefaultExpiry"], en["share.expiry.30"]);
  await page.getByRole("button", { name: en["settings.save"] }).click();
  await expect(page.getByTestId("unsaved")).toHaveText("");
  const admin = await apiAs(ADMIN.email, ADMIN.password);
  try {
    const s = await (await admin.get("/api/admin/settings")).json();
    expect(s.share_default_expiry_days).toBe(30);
  } finally {
    await admin.patch("/api/admin/settings", { data: { share_default_expiry_days: 7 } });
    await admin.dispose();
  }
});
