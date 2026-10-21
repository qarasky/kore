import { expect, test } from "@playwright/test";
import en from "../lib/i18n/en";
import { apiAs, createFolder, createUser, loginAs, uploadFile } from "./helpers";

test("folders show the total size of the files inside, live files only", async ({ page }) => {
  const user = await createUser();
  const api = await apiAs(user.email, user.password);
  const folder = await createFolder(api, "Reports");
  await createFolder(api, "Empty");
  await uploadFile(api, "a.bin", Buffer.alloc(1536, 1), { parent: folder });
  const b = await uploadFile(api, "b.bin", Buffer.alloc(2560, 2), { parent: folder });
  await loginAs(page, user.email, user.password);

  await page.goto("/files");
  const list = page.getByRole("listbox", { name: en["list.label"] });
  const reports = list.getByRole("option", { name: "Reports", exact: true });
  const size = reports.getByTestId("row-size");
  // 1536 + 2560 = 4096 bytes.
  await expect(size).toHaveText("4 KB");
  await expect(size).toHaveAttribute("title", en["list.folderSizeTitle"]);
  await expect(list.getByRole("option", { name: "Empty", exact: true }).getByTestId("row-size")).toHaveText("0 B");

  expect((await api.delete(`/api/nodes/${b}`)).status()).toBe(204);
  await page.reload();
  await expect(size).toHaveText("1.5 KB");
  await api.dispose();
});
