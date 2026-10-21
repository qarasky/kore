import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import en from "../lib/i18n/en";
import { ADMIN, apiAs, createFolder, createUser, loginAs, uploadFile, type CreatedUser } from "./helpers";

/**
 * Drag and drop upload and move against the real stack.
 *
 * Which browser path each test drives:
 * - OS file drops: a synthetic `DataTransfer` holding a real `File`,
 *   dispatched as dragenter/dragover/drop (Chromium can't synthesize a native
 *   OS drag). Such items have no `webkitGetAsEntry()` entry, so dropped
 *   *directories* are covered by unit tests (lib/__tests__/dropEntries) and by
 *   the folder <input> test here, not by a real directory drop.
 * - Row moves: real mouse drags (`locator.dragTo`), i.e. native HTML5 DnD.
 * - Large/resumed/failed uploads: the + New -> File upload menu entry and its
 *   file chooser (`setFiles`), which runs the same queue and uploader.
 */

type Listed = { id: string; name: string; is_dir: boolean; size: number };

const list = (page: Page) => page.getByRole("listbox", { name: en["list.label"] });
const row = (page: Page, name: string) => list(page).getByRole("option", { name, exact: true });
const nav = (page: Page) => page.getByRole("navigation", { name: en["nav.label"] });
const summary = (page: Page) => page.getByTestId("upload-summary");
const fill = (key: keyof typeof en, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce<string>((s, [k, v]) => s.replace(`{${k}}`, String(v)), en[key]);

async function setup(page: Page, quota?: number): Promise<{ user: CreatedUser; api: APIRequestContext }> {
  const user = await createUser({ quota_bytes: quota });
  const api = await apiAs(user.email, user.password);
  await loginAs(page, user.email, user.password);
  return { user, api };
}

async function children(api: APIRequestContext, space: "personal" | "shared", parent?: string): Promise<Listed[]> {
  const q = new URLSearchParams({ space });
  if (parent) q.set("parent", parent);
  const res = await api.get(`/api/nodes?${q}`);
  expect(res.status()).toBe(200);
  return res.json();
}

const names = (nodes: Listed[]) => nodes.map((n) => n.name).sort();

/** Dispatches an OS-like file drop of `files` onto `target` (see the header comment). */
async function dropFiles(page: Page, target: Locator, files: { name: string; content: string }[]) {
  const dt = await page.evaluateHandle((fs) => {
    const d = new DataTransfer();
    for (const f of fs) d.items.add(new File([f.content], f.name, { type: "text/plain" }));
    return d;
  }, files);
  await target.dispatchEvent("dragenter", { dataTransfer: dt });
  await target.dispatchEvent("dragover", { dataTransfer: dt });
  return {
    drop: () => target.dispatchEvent("drop", { dataTransfer: dt }),
  };
}

async function pickFiles(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.getByRole("button", { name: en["new.button"] }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: en["new.fileUpload"] }).click();
  await (await chooser).setFiles(files);
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

test("dropping a file onto the list uploads it into the current folder", async ({ page }) => {
  const { api } = await setup(page);
  const folder = await createFolder(api, "Inbox");
  await page.goto(`/files/${folder}`);
  await expect(list(page)).toBeVisible();

  const area = page.getByTestId("list-area");
  const d = await dropFiles(page, area, [{ name: "dropped.txt", content: "hello drop" }]);
  await expect(page.getByTestId("drop-overlay")).toHaveText(en["drop.overlay"]);
  await d.drop();
  await expect(page.getByTestId("drop-overlay")).toHaveCount(0);

  await expect(summary(page)).toHaveText(en["upload.summary.doneOne"]);
  await expect(row(page, "dropped.txt")).toBeVisible(); // refreshed once the queue drained
  const inFolder = await children(api, "personal", folder);
  expect(names(inFolder)).toEqual(["dropped.txt"]);
  const body = await (await api.get(`/api/nodes/${inFolder[0].id}/download`)).text();
  expect(body).toBe("hello drop");
  await api.dispose();
});

test("dropping a file onto a folder row uploads into that folder", async ({ page }) => {
  const { api } = await setup(page);
  const folder = await createFolder(api, "Target");
  await page.goto("/files");
  const target = row(page, "Target");
  const d = await dropFiles(page, target, [{ name: "into.txt", content: "x" }]);
  await expect(target).toHaveAttribute("data-drop-target", "true");
  await expect(page.getByTestId("drop-overlay")).toHaveText(fill("drop.overlayInto", { name: "Target" }));
  await d.drop();

  await expect(summary(page)).toHaveText(en["upload.summary.doneOne"]);
  expect(names(await children(api, "personal", folder))).toEqual(["into.txt"]);
  expect(names(await children(api, "personal"))).toEqual(["Target"]);
  await api.dispose();
});

test("in-page row drags don't trigger the upload overlay", async ({ page }) => {
  const { api } = await setup(page);
  await createFolder(api, "Box");
  await uploadFile(api, "a.txt", "a");
  await page.goto("/files");
  await row(page, "a.txt").hover();
  await page.mouse.down();
  const box = (await row(page, "Box").boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 8 });
  // A real drag is under way: the folder row accepts it...
  await expect(row(page, "Box")).toHaveAttribute("data-drop-target", "true");
  // ...but it is not a file drag, so there is no upload overlay.
  await expect(page.getByTestId("drop-overlay")).toHaveCount(0);
  // Release over empty list space: nothing happens.
  const area = (await page.getByTestId("list-area").boundingBox())!;
  await page.mouse.move(area.x + area.width / 2, area.y + area.height - 40, { steps: 5 });
  await expect(row(page, "Box")).not.toHaveAttribute("data-drop-target");
  await page.mouse.up();
  await expect(row(page, "a.txt")).toBeVisible();
  expect(names(await children(api, "personal"))).toEqual(["Box", "a.txt"]);
  await api.dispose();
});

test("dragging a file row onto a folder row moves it", async ({ page }) => {
  const { api } = await setup(page);
  const folder = await createFolder(api, "Archive");
  await uploadFile(api, "report.txt", "r");
  await page.goto("/files");

  await row(page, "report.txt").dragTo(row(page, "Archive"));
  await expect(row(page, "report.txt")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(fill("move.doneOne", { name: "report.txt" }));
  expect(names(await children(api, "personal", folder))).toEqual(["report.txt"]);
  await api.dispose();
});

test("dragging a multi-selection moves all of it; name collisions are reported", async ({ page }) => {
  const { api } = await setup(page);
  const folder = await createFolder(api, "Dest");
  await uploadFile(api, "one.txt", "1");
  await uploadFile(api, "two.txt", "2");
  await uploadFile(api, "two.txt", "already there", { parent: folder });
  await page.goto("/files");

  await row(page, "one.txt").click();
  await row(page, "two.txt").click({ modifiers: ["ControlOrMeta"] });
  await row(page, "two.txt").dragTo(row(page, "Dest"));
  await expect(page.getByRole("status")).toContainText(
    fill("move.partial", { done: 1, count: 2, reason: en["move.error.nameTaken"] }),
  );
  await expect(row(page, "one.txt")).toHaveCount(0);
  await expect(row(page, "two.txt")).toBeVisible();
  expect(names(await children(api, "personal", folder))).toEqual(["one.txt", "two.txt"]);
  await api.dispose();
});

test("dropping a folder onto itself or onto another dragged item is a no-op", async ({ page }) => {
  const { api } = await setup(page);
  await createFolder(api, "Alpha");
  await createFolder(api, "Beta");
  await page.goto("/files");
  const patches: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().includes("/api/nodes/")) patches.push(r.url());
  });

  // Onto itself (moved within its own row).
  await row(page, "Alpha").dragTo(row(page, "Alpha"), { sourcePosition: { x: 20, y: 8 }, targetPosition: { x: 300, y: 20 } });
  // A selection of both, dropped onto one of the dragged folders.
  await row(page, "Alpha").click();
  await row(page, "Beta").click({ modifiers: ["ControlOrMeta"] });
  await row(page, "Alpha").dragTo(row(page, "Beta"));

  await page.waitForTimeout(300);
  expect(patches).toEqual([]);
  await expect(page.getByRole("status")).toBeEmpty();
  expect(names(await children(api, "personal"))).toEqual(["Alpha", "Beta"]);

  // Control: the same drag with only Alpha selected does move it.
  await row(page, "Alpha").click();
  await row(page, "Alpha").dragTo(row(page, "Beta"));
  await expect(row(page, "Alpha")).toHaveCount(0);
  expect(patches).toHaveLength(1);
  await api.dispose();
});

test("dropping a folder onto its own child (stale page) changes nothing and shows the server's reason", async ({ page }) => {
  const { api } = await setup(page);
  const outer = await createFolder(api, "Outer");
  const inner = await createFolder(api, "Inner");
  await page.goto("/files");
  await expect(row(page, "Inner")).toBeVisible();
  // Behind the page's back, Inner becomes a child of Outer; the page still shows both at root.
  expect((await api.patch(`/api/nodes/${inner}`, { data: { parent_id: outer } })).status()).toBe(200);

  await row(page, "Outer").dragTo(row(page, "Inner"));
  await expect(page.getByRole("status")).toContainText(en["move.error.intoItself"]);
  expect(names(await children(api, "personal"))).toEqual(["Outer"]);
  expect(names(await children(api, "personal", outer))).toEqual(["Inner"]);
  await expect(row(page, "Inner")).toHaveCount(0); // refreshed to the real state
  await api.dispose();
});

test("breadcrumb drop moves a row up; the current crumb is not a target", async ({ page }) => {
  const { api } = await setup(page);
  const parent = await createFolder(api, "Parent");
  await uploadFile(api, "deep.txt", "d", { parent });
  await page.goto(`/files/${parent}`);
  const crumbs = page.getByRole("navigation", { name: en["breadcrumbs.label"] });

  await row(page, "deep.txt").dragTo(page.getByTestId("current-folder"));
  await page.waitForTimeout(200);
  await expect(row(page, "deep.txt")).toBeVisible();

  await row(page, "deep.txt").dragTo(crumbs.getByRole("link", { name: en["nav.myFiles"] }));
  await expect(row(page, "deep.txt")).toHaveCount(0);
  expect(names(await children(api, "personal"))).toEqual(["Parent", "deep.txt"]);
  await api.dispose();
});

test("drag between My files and Shared space via the sidebar", async ({ page }) => {
  const { api } = await setup(page);
  const name = `travel-${Date.now()}.txt`;
  await uploadFile(api, name, "t");
  await page.goto("/files");

  await row(page, name).dragTo(nav(page).getByRole("link", { name: en["nav.shared"] }));
  await expect(row(page, name)).toHaveCount(0);
  expect((await children(api, "shared")).map((n) => n.name)).toContain(name);

  await page.goto("/shared");
  // Dropping onto the section you're in is a no-op.
  await row(page, name).dragTo(nav(page).getByRole("link", { name: en["nav.shared"] }));
  await page.waitForTimeout(200);
  await expect(row(page, name)).toBeVisible();

  await row(page, name).dragTo(nav(page).getByRole("link", { name: en["nav.myFiles"] }));
  await expect(row(page, name)).toHaveCount(0);
  expect(names(await children(api, "personal"))).toEqual([name]);
  await api.dispose();
});

test("a 25 MB file uploads in 1 MiB chunks and downloads byte-identical", async ({ page }) => {
  test.setTimeout(120_000);
  const { api } = await setup(page);
  await page.goto("/files");
  await page.evaluate(() => localStorage.setItem("koreChunkBytes", String(1 << 20)));
  const patches: number[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().includes("/api/uploads/")) patches.push(Number(r.headers()["upload-offset"]));
  });

  const data = randomBytes(25 * 1024 * 1024);
  await pickFiles(page, [{ name: "big.bin", mimeType: "application/octet-stream", buffer: data }]);
  await expect(page.getByTestId("upload-item")).toHaveAttribute("data-state", "uploading");
  await expect(summary(page)).toHaveText(en["upload.summary.doneOne"], { timeout: 90_000 });

  expect(patches).toEqual(Array.from({ length: 25 }, (_, i) => i * (1 << 20)));
  const [node] = await children(api, "personal");
  expect(node).toMatchObject({ name: "big.bin", size: data.length });
  const body = await (await api.get(`/api/nodes/${node.id}/download`)).body();
  expect(sha256(body)).toBe(sha256(data));
  await expect(row(page, "big.bin")).toBeVisible();
  await api.dispose();
});

test("an interrupted chunk is resumed from the server offset", async ({ page }) => {
  const { api } = await setup(page);
  await page.goto("/files");
  await page.evaluate(() => localStorage.setItem("koreChunkBytes", String(1 << 20)));
  let n = 0;
  const seen: string[] = [];
  await page.route("**/api/uploads/**", async (route) => {
    const r = route.request();
    seen.push(`${r.method()} ${r.headers()["upload-offset"] ?? ""}`.trim());
    if (r.method() === "PATCH" && ++n === 3) return route.abort("connectionreset");
    return route.continue();
  });

  const data = randomBytes(5 * 1024 * 1024 + 123);
  await pickFiles(page, [{ name: "resume.bin", mimeType: "application/octet-stream", buffer: data }]);
  await expect(summary(page)).toHaveText(en["upload.summary.doneOne"], { timeout: 30_000 });

  const MiB = 1 << 20;
  expect(seen).toEqual([
    `PATCH 0`,
    `PATCH ${MiB}`,
    `PATCH ${2 * MiB}`, // dropped
    "HEAD",
    `PATCH ${2 * MiB}`,
    `PATCH ${3 * MiB}`,
    `PATCH ${4 * MiB}`,
    `PATCH ${5 * MiB}`,
    "POST",
  ]);
  const [node] = await children(api, "personal");
  expect(sha256(await (await api.get(`/api/nodes/${node.id}/download`)).body())).toBe(sha256(data));
  // The resume key is gone once the upload completed.
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("kore.upload:")))).toEqual([]);
  await api.dispose();
});

test("Folder upload recreates the tree, reusing an existing folder and skipping OS junk", async ({ page }) => {
  const { api } = await setup(page);
  const existing = await createFolder(api, "tree");
  const dir = mkdtempSync(path.join(tmpdir(), "kore-dnd-"));
  try {
    const root = path.join(dir, "tree");
    mkdirSync(path.join(root, "sub", "deeper"), { recursive: true });
    writeFileSync(path.join(root, "a.txt"), "a");
    writeFileSync(path.join(root, ".env"), "dotfiles are kept");
    writeFileSync(path.join(root, ".DS_Store"), "junk");
    writeFileSync(path.join(root, "sub", "b.txt"), "b");
    writeFileSync(path.join(root, "sub", "deeper", "c.txt"), "c");
    writeFileSync(path.join(root, "sub", "Thumbs.db"), "junk");

    await page.goto("/files");
    await page.getByTestId("upload-folder-input").setInputFiles(root);
    await expect(summary(page)).toHaveText(fill("upload.summary.doneMany", { count: 4 }));

    const top = await children(api, "personal");
    expect(top.map((n) => n.id)).toEqual([existing]); // the existing "tree" was reused
    const tree = await children(api, "personal", existing);
    expect(names(tree)).toEqual([".env", "a.txt", "sub"]);
    const sub = tree.find((n) => n.name === "sub")!;
    const subKids = await children(api, "personal", sub.id);
    expect(names(subKids)).toEqual(["b.txt", "deeper"]);
    const deeper = subKids.find((n) => n.name === "deeper")!;
    expect(names(await children(api, "personal", deeper.id))).toEqual(["c.txt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await api.dispose();
  }
});

test("quota exceeded and over-limit files show plain-language errors", async ({ page }) => {
  const { api } = await setup(page, 1024);
  await page.goto("/files");

  await pickFiles(page, [{ name: "too-much.bin", mimeType: "application/octet-stream", buffer: randomBytes(4096) }]);
  const item = page.getByTestId("upload-item");
  await expect(item).toHaveAttribute("data-state", "error");
  await expect(item).toContainText(en["upload.error.quota"]);
  await expect(summary(page)).toHaveText(fill("upload.summary.failed", { failed: 1, count: 1 }));
  await expect(page.getByRole("button", { name: fill("upload.retry", { name: "too-much.bin" }) })).toBeVisible();
  expect(await children(api, "personal")).toEqual([]);

  const admin = await apiAs(ADMIN.email, ADMIN.password);
  try {
    expect((await admin.patch("/api/admin/settings", { data: { max_file_bytes: 100 } })).status()).toBe(200);
    await page.getByRole("button", { name: en["upload.close"] }).click();
    await pickFiles(page, [{ name: "large.bin", mimeType: "application/octet-stream", buffer: randomBytes(200) }]);
    await expect(page.getByTestId("upload-item")).toContainText(en["upload.error.tooLarge"]);
  } finally {
    expect((await admin.patch("/api/admin/settings", { data: { max_file_bytes: 0 } })).status()).toBe(200);
    await admin.dispose();
    await api.dispose();
  }
});
