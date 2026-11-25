import { expect, test } from "@playwright/test";
import en from "../lib/i18n/en";
import { formatBytes } from "../lib/format";
import { apiAs, createFolder, createUser, loginAs, uploadFile } from "./helpers";

const KiB = 1024;

test("the storage meter opens a breakdown by file type with the largest files", async ({ page }) => {
  const user = await createUser({ quota_bytes: 10 * 1024 * KiB });
  const api = await apiAs(user.email, user.password);
  const docs = await createFolder(api, "Docs");
  await uploadFile(api, "photo.PNG", Buffer.alloc(30 * KiB, 1));
  await uploadFile(api, "clip.mp4", Buffer.alloc(200 * KiB, 2), { space: "shared" });
  const pdf = await uploadFile(api, "report.pdf", Buffer.alloc(100 * KiB, 3), { parent: docs });
  const old = await uploadFile(api, "old.zip", Buffer.alloc(50 * KiB, 4));
  expect((await api.delete(`/api/nodes/${old}`)).status()).toBe(204);
  await api.dispose();

  await loginAs(page, user.email, user.password);
  await page.goto("/files");
  const meter = page.getByTestId("storage-meter").getByRole("button");
  await expect(meter).toHaveAttribute("aria-haspopup", "dialog");
  await meter.click();
  const dialog = page.getByRole("dialog", { name: en["storage.title"] });
  await expect(dialog).toBeVisible();
  const used = (30 + 200 + 100 + 50) * KiB;
  await expect(dialog).toContainText(`${formatBytes(used)} of ${formatBytes(10 * 1024 * KiB)} used`);

  // Bars by type, largest first, with size and percent of what is used.
  const bars = dialog.getByRole("list", { name: en["storage.byType"] }).getByRole("listitem");
  await expect(bars).toHaveCount(4);
  await expect(bars.nth(0)).toHaveAttribute("data-category", "video");
  await expect(bars.nth(1)).toHaveAttribute("data-category", "documents");
  await expect(bars.nth(2)).toHaveAttribute("data-category", "archives");
  await expect(bars.nth(3)).toHaveAttribute("data-category", "images");
  await expect(bars.nth(0)).toContainText(en["storage.cat.video"]);
  await expect(bars.nth(0)).toContainText(formatBytes(200 * KiB));
  await expect(bars.nth(0)).toContainText(`${Math.round((200 / 380) * 100)}%`);
  await expect(bars.nth(3)).toContainText(en["storage.filesOne"]);

  // Trash is reported on its own line, with a link (nothing is deleted here).
  await expect(dialog.getByTestId("storage-trash-personal")).toContainText(formatBytes(50 * KiB));
  await expect(dialog.getByTestId("storage-trash-shared")).toHaveCount(0);

  // Largest files: live only (the trashed zip is not listed).
  const largest = dialog.getByRole("list", { name: en["storage.largest"] }).getByRole("link");
  await expect(largest).toHaveCount(3);
  await expect(largest.nth(0)).toContainText("clip.mp4");
  await expect(largest.nth(1)).toContainText("report.pdf");
  await expect(largest.nth(2)).toContainText("photo.PNG");

  // Keyboard: Tab reaches the links; Enter on one goes to its folder with it selected.
  await largest.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(`/files/${docs}?select=${pdf}`);
  await expect(
    page.getByRole("listbox", { name: en["list.label"] }).getByRole("option", { name: "report.pdf", exact: true }),
  ).toHaveAttribute("aria-selected", "true");

  // The trash link only opens the trash tab that holds it.
  await meter.click();
  await dialog.getByRole("link", { name: en["storage.openTrashMine"] }).click();
  await expect(page).toHaveURL("/trash");
  await expect(page.getByRole("listbox", { name: en["trash.list"] }).getByRole("option", { name: "old.zip" })).toBeVisible();
});

test("an empty account shows the empty state; Escape closes", async ({ page }) => {
  const user = await createUser();
  await loginAs(page, user.email, user.password);
  await page.goto("/files");
  const meter = page.getByTestId("storage-meter").getByRole("button");
  await meter.click();
  const dialog = page.getByRole("dialog", { name: en["storage.title"] });
  await expect(dialog.getByText(en["storage.empty"])).toBeVisible();
  await expect(dialog.getByRole("list", { name: en["storage.byType"] })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(meter).toBeFocused();
});

test("a trashed shared upload is reported under the shared trash and links there", async ({ page }) => {
  const user = await createUser();
  const api = await apiAs(user.email, user.password);
  const name = `sb-${Date.now()}-team.zip`;
  const id = await uploadFile(api, name, Buffer.alloc(20 * KiB, 5), { space: "shared" });
  expect((await api.delete(`/api/nodes/${id}`)).status()).toBe(204);
  await api.dispose();

  await loginAs(page, user.email, user.password);
  await page.goto("/files");
  await page.getByTestId("storage-meter").getByRole("button").click();
  const dialog = page.getByRole("dialog", { name: en["storage.title"] });
  await expect(dialog.getByTestId("storage-trash-shared")).toContainText(formatBytes(20 * KiB));
  await expect(dialog.getByTestId("storage-trash-personal")).toHaveCount(0);
  await dialog.getByRole("link", { name: en["storage.openTrashShared"] }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL("/trash?space=shared");
  await expect(page.getByRole("link", { name: en["trash.shared"] })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("listbox", { name: en["trash.list"] }).getByRole("option", { name })).toBeVisible();
});
