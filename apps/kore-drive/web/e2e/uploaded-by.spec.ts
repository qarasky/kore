import { expect, test, type Page } from "@playwright/test";
import en from "../lib/i18n/en";
import { apiAs, createUser, loginAs, uploadFile } from "./helpers";

const list = (page: Page, name: string = en["list.label"]) => page.getByRole("listbox", { name });
const row = (page: Page, name: string, listName?: string) => list(page, listName).getByRole("option", { name, exact: true });
const header = (page: Page) => page.getByText(en["list.uploadedBy"], { exact: true });

test("shared items show who uploaded them; My files has no such column", async ({ page }) => {
  const a = await createUser();
  const b = await createUser();
  const apiA = await apiAs(a.email, a.password);
  const name = `ub-${Date.now()}-shared.txt`;
  const mine = `ub-${Date.now()}-mine.txt`;
  await uploadFile(apiA, name, "from A", { space: "shared" });
  const apiB = await apiAs(b.email, b.password);
  await uploadFile(apiB, mine, "from B");

  await page.setViewportSize({ width: 1400, height: 800 });
  await loginAs(page, b.email, b.password);
  await page.goto("/shared");
  await expect(header(page)).toBeVisible();
  const cell = row(page, name).getByTestId("row-uploader");
  await expect(cell).toHaveText(a.email);
  await expect(cell).toHaveAttribute("title", a.email);

  // Narrow viewports drop the column before the name gets squeezed.
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(cell).toBeHidden();
  await expect(header(page)).toBeHidden();
  await expect(row(page, name)).toBeVisible();
  await page.setViewportSize({ width: 1400, height: 800 });

  // My files: no column, no email anywhere in the rows.
  await page.goto("/files");
  await expect(row(page, mine)).toBeVisible();
  await expect(header(page)).toHaveCount(0);
  await expect(row(page, mine).getByTestId("row-uploader")).toHaveCount(0);

  // Search: the shared hit shows the uploader, the personal hit does not.
  await page.goto(`/search?q=${encodeURIComponent("ub-")}`);
  const results = en["search.results"];
  await expect(row(page, name, results).getByTestId("row-uploader")).toHaveText(a.email);
  await expect(row(page, mine, results).getByTestId("row-uploader")).toHaveText("");

  // Shared trash shows it too; My trash does not have the column.
  const sharedId = (await (await apiA.get("/api/nodes?space=shared")).json()).find((n: { name: string }) => n.name === name).id;
  expect((await apiA.delete(`/api/nodes/${sharedId}`)).status()).toBe(204);
  await page.goto("/trash?space=shared");
  await expect(row(page, name, en["trash.list"]).getByTestId("row-uploader")).toHaveText(a.email);
  const mineId = (await (await apiB.get("/api/nodes?space=personal")).json()).find((n: { name: string }) => n.name === mine).id;
  expect((await apiB.delete(`/api/nodes/${mineId}`)).status()).toBe(204);
  await page.goto("/trash");
  await expect(row(page, mine, en["trash.list"])).toBeVisible();
  await expect(header(page)).toHaveCount(0);
  await apiA.dispose();
  await apiB.dispose();
});
